// The process table as one snapshot, and walks up it. Used to find the pane or tab a session runs in.
import { basename } from "node:path";
import type { RunCommand } from "../config/bind.js";

/** `tty` is as `ps` prints it: `ttys001` on macOS, `pts/3` on Linux, `??` or `?` without a terminal. */
export type ProcessInfo = { pid: number; ppid: number; tty: string; command: string };
export type ProcessTable = ReadonlyMap<number, ProcessInfo>;

const LINE_PATTERN = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/;
const MAX_DEPTH = 64;

export function parseProcessTable(output: string): ProcessTable {
  const table = new Map<number, ProcessInfo>();
  for (const line of output.split("\n")) {
    const match = LINE_PATTERN.exec(line);
    if (match === null) continue;
    const [, pid = "", ppid = "", tty = "", command = ""] = match;
    table.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), tty, command });
  }
  return table;
}

// One read of the process table at a time per runner: callers that arrive while a read runs share its answer instead
// of starting another `ps`. On 2026-11-21 an overloaded machine made each `ps` take minutes, every poll started a new
// one, and thousands piled up. Only this read-only query is shared; commands with side effects never are.
const inFlight = new WeakMap<RunCommand, Promise<ProcessTable>>();

export async function readProcessTable(run: RunCommand): Promise<ProcessTable> {
  const running = inFlight.get(run);
  if (running !== undefined) return running;
  const read = run("ps", ["-A", "-o", "pid=,ppid=,tty=,comm="])
    .then(parseProcessTable)
    .finally(() => {
      inFlight.delete(run);
    });
  inFlight.set(run, read);
  return read;
}

/** Executable name without path and without the leading dash of a login shell. */
export function commandName(info: ProcessInfo): string {
  return basename(info.command).replace(/^-/, "").toLowerCase();
}

/** The process itself, then its parent, grandparent and so on, nearest first. */
export function ancestry(table: ProcessTable, pid: number): ProcessInfo[] {
  const chain: ProcessInfo[] = [];
  let current = table.get(pid);
  while (current !== undefined && chain.length < MAX_DEPTH && !chain.some((seen) => seen.pid === current?.pid)) {
    chain.push(current);
    current = table.get(current.ppid);
  }
  return chain;
}
