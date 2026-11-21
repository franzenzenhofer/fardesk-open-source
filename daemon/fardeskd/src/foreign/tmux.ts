import { randomUUID } from "node:crypto";
import type { RunCommand, RunWithInput } from "../config/bind.js";
import { FardeskError } from "../core/errors.js";
import { assertSandboxTmux, sandboxAllowsDefaultServer, sandboxAllowsSocket } from "../core/sandbox.js";
import { ancestry } from "./processTree.js";
import type { ProcessTable } from "./processTree.js";
import { listTmuxSockets, socketAccepts } from "./tmuxSockets.js";

const PANE_PATTERN = /^[A-Za-z0-9_.:@%$-]+$/;
const ESCAPE_KEY = "Escape";
const ENTER_KEY = "Enter";
const PANE_FORMAT = "#{pane_pid} #{pane_id}";
const PANE_LINE = /^(\d+) (%\d+)$/;

/** A pane and the server it lives on: pane ids like `%3` are only unique per server. `socket` null = the default server. */
export type PaneRef = { pane: string; socket: string | null; panePid: number };

export type TmuxOptions = {
  tmuxBinary: string;
  pane: string;
  /** Socket path of the server holding the pane (`tmux -S`); null for the default server. */
  socket?: string | null;
  run: RunCommand;
};

export type SendEscapeOptions = TmuxOptions;

function validPane(pane: string): string {
  if (!PANE_PATTERN.test(pane) || pane.startsWith("-")) throw new FardeskError("invalid_request", `invalid tmux pane target: ${pane}`);
  return pane;
}

const serverArgs = (socket: string | null | undefined): string[] => (socket === null || socket === undefined ? [] : ["-S", socket]);

async function tmux(options: TmuxOptions, args: string[], action: string): Promise<string> {
  assertSandboxTmux(options.tmuxBinary, options.socket);
  try {
    return await options.run(options.tmuxBinary, [...serverArgs(options.socket), ...args]);
  } catch (error) {
    throw new FardeskError("unsupported", `tmux pane ${options.pane} is not reachable (${action}): ${(error as Error).message}`);
  }
}

export async function sendEscape(options: SendEscapeOptions): Promise<void> {
  await tmux(options, ["send-keys", "-t", validPane(options.pane), ESCAPE_KEY], "send Escape");
}

/** Types `text` as keystrokes without pressing Enter (a dialog that takes a number key selects on the key alone). */
export async function sendLiteral(options: TmuxOptions & { text: string }): Promise<void> {
  await tmux(options, ["send-keys", "-t", validPane(options.pane), "-l", "--", options.text], "type keys");
}

export async function sendEnter(options: TmuxOptions): Promise<void> {
  await tmux(options, ["send-keys", "-t", validPane(options.pane), ENTER_KEY], "press Enter");
}

async function panesOfServer(options: { tmuxBinary: string; run: RunCommand }, socket: string | null): Promise<PaneRef[]> {
  let listing: string;
  try {
    listing = await options.run(options.tmuxBinary, [...serverArgs(socket), "list-panes", "-a", "-F", PANE_FORMAT]);
  } catch {
    return [];
  }
  const panes: PaneRef[] = [];
  for (const line of listing.split("\n")) {
    const match = PANE_LINE.exec(line.trim());
    if (match?.[1] !== undefined && match[2] !== undefined) panes.push({ pane: match[2], socket, panePid: Number(match[1]) });
  }
  return panes;
}

/** Every pane of every tmux server of this user (default server first, then each socket found on disk). */
export async function listAllPanes(options: { tmuxBinary: string; run: RunCommand }): Promise<PaneRef[]> {
  const uid = process.getuid?.() ?? 0;
  const candidates = listTmuxSockets(process.env, uid).filter(sandboxAllowsSocket);
  const alive = await Promise.all(candidates.map(async (path) => socketAccepts(path)));
  const sockets = candidates.filter((_, index) => alive[index]);
  // Under the test sandbox the real default server (where the test runner itself may live) is never looked at.
  const servers: (string | null)[] = sandboxAllowsDefaultServer(options.tmuxBinary) ? [null, ...sockets] : sockets;
  const found = await Promise.all(servers.map(async (socket) => panesOfServer(options, socket)));
  return found.flat();
}

/** The pane whose shell is `pid` or one of its ancestors (nearest first), or null when the process runs outside tmux. */
export function paneOf(panes: PaneRef[], table: ProcessTable, pid: number): PaneRef | null {
  for (const process of ancestry(table, pid)) {
    const pane = panes.find((candidate) => candidate.panePid === process.pid);
    if (pane !== undefined) return pane;
  }
  return null;
}

/** Types `text` into the pane as if the user typed it, then presses Enter. Several lines go in as one bracketed paste. */
export async function sendText(options: TmuxOptions & { text: string; runWithInput: RunWithInput }): Promise<void> {
  const target = validPane(options.pane);
  if (!options.text.includes("\n")) {
    await tmux(options, ["send-keys", "-t", target, "-l", "--", options.text], "type text");
  } else {
    const buffer = `fardesk-${randomUUID()}`;
    assertSandboxTmux(options.tmuxBinary, options.socket);
    const load = [...serverArgs(options.socket), "load-buffer", "-b", buffer, "-"];
    await options.runWithInput(options.tmuxBinary, load, options.text).catch((error: unknown) => {
      throw new FardeskError("unsupported", `tmux buffer could not be loaded: ${(error as Error).message}`);
    });
    await tmux(options, ["paste-buffer", "-d", "-p", "-b", buffer, "-t", target], "paste text");
  }
  await tmux(options, ["send-keys", "-t", target, ENTER_KEY], "press Enter");
}

export async function killPane(options: TmuxOptions): Promise<void> {
  await tmux(options, ["kill-pane", "-t", validPane(options.pane)], "kill pane");
}

export async function paneExists(options: TmuxOptions): Promise<boolean> {
  try {
    const listing = await options.run(options.tmuxBinary, [...serverArgs(options.socket), "list-panes", "-a", "-F", "#{pane_id}"]);
    return listing.split("\n").includes(options.pane);
  } catch {
    return false;
  }
}
