// Real terminals for tests: a private tmux server (own socket, sessions named fardesk-test-*) and a fake terminal-app -> shell -> process tab.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { chmodSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir, waitUntil } from "./env.js";

const SHELL_BINARY = "/bin/sh";
const LONG_SLEEP_SECONDS = 300;

export type TmuxSandbox = {
  /** A tmux binary that only talks to this sandbox's private server. Pass it as `tmuxBinary`. */
  binary: string;
  /** Starts a detached session running `command`; resolves to its first pane id and pane pid. */
  start(command: string): { pane: string; panePid: number };
  paneIds(): string[];
  childOf(pid: number): Promise<number>;
  dispose(): void;
};

/** A tmux binary that does not pick a server itself, so the daemon must find servers by socket (-S). Guarded: input only goes to fardesk-test-* sockets. */
export function writePlainWrapper(): string {
  const binary = join(makeTempDir("fdt-"), "tmux-plain");
  writeFileSync(binary, `#!/bin/sh\nexec tmux "$@"\n`);
  chmodSync(binary, 0o755);
  return binary;
}

export function writeWrapper(): { binary: string } {
  const dir = makeTempDir("fdt-");
  const socket = `fardesk-test-${Math.random().toString(36).slice(2, 10)}`;
  const binary = join(dir, "tmux-sandbox");
  writeFileSync(binary, `#!/bin/sh\nexec tmux -L ${socket} "$@"\n`);
  chmodSync(binary, 0o755);
  return { binary };
}

export function createTmuxSandbox(): TmuxSandbox {
  const { binary } = writeWrapper();
  const tmux = (...args: string[]): string => execFileSync(binary, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  let count = 0;
  return {
    binary,
    start(command): { pane: string; panePid: number } {
      count += 1;
      const [line = ""] = tmux("new-session", "-d", "-P", "-F", "#{pane_id} #{pane_pid}", "-s", `fardesk-test-${count}`, command).trim().split("\n");
      const [pane = "", panePid = ""] = line.split(" ");
      return { pane, panePid: Number(panePid) };
    },
    paneIds: () => listPanes(tmux),
    async childOf(pid): Promise<number> {
      let found = 0;
      await waitUntil(() => {
        found = Number(spawnPgrep(pid));
        return found > 0;
      });
      return found;
    },
    dispose(): void {
      try {
        tmux("kill-server");
      } catch {
        // no server left
      }
    },
  };
}

function listPanes(tmux: (...args: string[]) => string): string[] {
  try {
    return tmux("list-panes", "-a", "-F", "#{pane_id}").trim().split("\n").filter((id) => id.length > 0);
  } catch {
    return [];
  }
}

function killMatching(pattern: string): void {
  try {
    execFileSync("pkill", ["-f", pattern]);
  } catch {
    // none left
  }
}

function killAll(pids: number[]): void {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}

function spawnPgrep(parent: number): string {
  try {
    return execFileSync("pgrep", ["-P", String(parent)], { encoding: "utf8" }).split("\n")[0] ?? "";
  } catch {
    return "";
  }
}

export type FakeTab = { terminalPid: number; shellPid: number; claudePid: number; child: ChildProcess; dispose(): void };

/** `<terminalName> -> zsh -> sleep`, as a real process tree: the link names make `ps` show a terminal app and a login shell. */
const uniqueSleepSeconds = (): number => 1000 + Math.floor(Math.random() * 1_000_000);

export async function startFakeTab(terminalName: string): Promise<FakeTab> {
  const dir = makeTempDir("fdtab-");
  const secondSleep = uniqueSleepSeconds();
  const terminal = join(dir, terminalName);
  const shell = join(dir, "zsh");
  symlinkSync(SHELL_BINARY, terminal);
  symlinkSync(SHELL_BINARY, shell);
  const inner = `${shell} -c "sleep ${LONG_SLEEP_SECONDS}; sleep ${secondSleep}; true"; true`;
  const child = spawn(terminal, ["-c", inner], { stdio: "ignore" });
  const terminalPid = child.pid ?? 0;
  let shellPid = 0;
  let claudePid = 0;
  await waitUntil(() => {
    shellPid = Number(spawnPgrep(terminalPid));
    claudePid = shellPid > 0 ? Number(spawnPgrep(shellPid)) : 0;
    return claudePid > 0;
  });
  return {
    terminalPid,
    shellPid,
    claudePid,
    child,
    dispose(): void {
      killMatching(`^sleep ${secondSleep}$`);
      killAll([claudePid, shellPid, terminalPid]);
    },
  };
}
