// A scripted `ps` for the home discovery: answers the way the real tool does for the two calls the daemon makes.
// `-o pid=,comm=` lists process names only; `eww ... -p <pids>` gives the command line with environment for the
// requested pids only. Lines are written like `ps eww` output: "  <pid> <executable> <args and environment>".
import type { RunCommand } from "../../src/config/bind.js";

export type PsCall = { args: string[] };

export function fakePs(lines: string[], calls: PsCall[] = []): RunCommand {
  const rows = lines.map((line) => {
    const [, pid = "", rest = ""] = /^\s*(\d+)\s+(.*)$/.exec(line) ?? [];
    return { pid, comm: rest.split(/\s+/)[0] ?? "", line };
  });
  return (_command, args) => {
    calls.push({ args });
    if (!args.includes("eww")) return Promise.resolve(rows.map((row) => `${row.pid} ${row.comm}`).join("\n"));
    const wanted = new Set((args[args.indexOf("-p") + 1] ?? "").split(","));
    return Promise.resolve(rows.filter((row) => wanted.has(row.pid)).map((row) => row.line).join("\n"));
  };
}

/** One running claude process per home, each started with CLAUDE_CONFIG_DIR=<home>. */
export function claudeProcesses(...homes: string[]): string[] {
  return homes.map((home, index) => `  ${100 + index} /usr/local/bin/claude TERM=xterm CLAUDE_CONFIG_DIR=${home}`);
}
