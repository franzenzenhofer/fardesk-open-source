// Ghostty (macOS) through its AppleScript dictionary: find the terminal that holds a session's process, type into it, close it.
// Only a terminal whose tty or process belongs to the session's own claude process is ever matched or touched.
import type { RunCommand } from "../config/bind.js";
import type { GhosttyAutomation } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { assertSandboxPath } from "../core/sandbox.js";
import { installScripts } from "./ghosttyScripts.js";
import { ancestry, commandName } from "./processTree.js";
import type { ProcessTable } from "./processTree.js";

const GHOSTTY_PROCESS = "ghostty";
const DENIED_PATTERN = /-1743|not authorized to send apple events/i;
const NO_TTY = new Set(["??", "?", "-", ""]);
const FIELDS = 4;

export type GhosttyTerminal = { id: string; tty: string; pid: number; cwd: string };

export type GhosttyOptions = {
  stateDir: string;
  osascriptBinary: string;
  run: RunCommand;
  log: Logger;
  /** How long a terminal listing is reused (the match cache). */
  cacheMs: number;
  /** A reply must not hang on an unanswered consent dialog. */
  timeoutMs: number;
  now: () => number;
};

export type Ghostty = {
  status(): GhosttyAutomation;
  /** True when `pid` runs below a Ghostty process: only then is Ghostty worth asking at all. */
  hosts(table: ProcessTable, pid: number): boolean;
  /** The terminal holding `pid`, or null. Rejects with the osascript error; a denied Automation consent sets the status to denied. */
  find(table: ProcessTable, pid: number): Promise<GhosttyTerminal | null>;
  type(terminalId: string, text: string): Promise<void>;
  close(terminalId: string): Promise<void>;
  /** Lists the terminals once (this is what makes macOS ask for consent) and reports the resulting status. */
  probe(): Promise<GhosttyAutomation>;
};

export function parseTerminalList(output: string): GhosttyTerminal[] {
  const terminals: GhosttyTerminal[] = [];
  for (const line of output.split("\n")) {
    const fields = line.replace(/\r$/, "").split("\t");
    const [id = "", tty = "", pid = "", ...cwd] = fields;
    if (fields.length < FIELDS || id === "" || !/^\d+$/.test(pid)) continue;
    terminals.push({ id, tty, pid: Number(pid), cwd: cwd.join("\t") });
  }
  return terminals;
}

const bareTty = (tty: string): string => tty.replace(/^\/dev\//, "");

/** The terminal of `pid`: same controlling tty first; without a tty, the terminal's foreground process is `pid` itself or one of its descendants (never an ancestor). Ambiguity gives null. */
export function matchTerminal(table: ProcessTable, pid: number, terminals: GhosttyTerminal[]): GhosttyTerminal | null {
  const own = table.get(pid);
  if (own === undefined) return null;
  const byTty = NO_TTY.has(own.tty) ? [] : terminals.filter((terminal) => bareTty(terminal.tty) === own.tty);
  if (byTty.length > 0) return byTty.length === 1 ? (byTty[0] ?? null) : null;
  const byPid = terminals.filter((terminal) => ancestry(table, terminal.pid).some((process) => process.pid === pid));
  return byPid.length === 1 ? (byPid[0] ?? null) : null;
}

export function hostedByGhostty(table: ProcessTable, pid: number): boolean {
  return ancestry(table, pid).some((process) => commandName(process) === GHOSTTY_PROCESS);
}

async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { reject(new FardeskError("unsupported", `${what} did not answer within ${ms} ms (a macOS consent dialog may be open)`)); }, ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Runs script files with osascript and keeps the Automation status that follows from the outcomes. */
function createChannel(options: GhosttyOptions): { run: (script: string, args: string[]) => Promise<string>; status: () => GhosttyAutomation } {
  let automation: GhosttyAutomation = "unknown";
  return {
    status: () => automation,
    run: async (script, args): Promise<string> => {
      assertSandboxPath("osascript", options.osascriptBinary);
      try {
        const out = await withTimeout(options.run(options.osascriptBinary, [script, ...args]), options.timeoutMs, "osascript");
        automation = "ok";
        return out;
      } catch (error) {
        const message = (error as Error).message;
        if (DENIED_PATTERN.test(message)) {
          automation = "denied";
          options.log.warn("ghostty_automation_denied", { hint: "allow the fardeskd node process to control Ghostty in System Settings > Privacy & Security > Automation", error: message });
        }
        throw error;
      }
    },
  };
}

export function createGhostty(options: GhosttyOptions): Ghostty {
  const scripts = installScripts(options.stateDir);
  const channel = createChannel(options);
  let listing: { at: number; terminals: GhosttyTerminal[] } | null = null;

  const terminals = async (): Promise<GhosttyTerminal[]> => {
    if (listing !== null && options.now() - listing.at < options.cacheMs) return listing.terminals;
    const fresh = parseTerminalList(await channel.run(scripts.list, []));
    listing = { at: options.now(), terminals: fresh };
    return fresh;
  };

  return {
    status: channel.status,
    hosts: hostedByGhostty,
    find: async (table, pid) => matchTerminal(table, pid, await terminals()),
    async type(terminalId, text): Promise<void> {
      await channel.run(scripts.type, [text, terminalId]);
    },
    async close(terminalId): Promise<void> {
      listing = null;
      await channel.run(scripts.close, [terminalId]);
    },
    async probe(): Promise<GhosttyAutomation> {
      listing = null;
      await terminals().catch((error: unknown) => {
        options.log.warn("ghostty_probe_failed", { error: (error as Error).message });
      });
      return channel.status();
    },
  };
}
