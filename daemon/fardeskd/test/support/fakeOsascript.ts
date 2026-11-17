// A real executable standing in for /usr/bin/osascript: it answers the three Ghostty scripts from files next to it
// (terminals.tsv, a `deny` flag file) and records what it was asked to type or close (typed.log, closed.log).
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTempDir } from "./env.js";

const DENIED_MESSAGE = "execution error: Not authorized to send Apple events to Ghostty. (-1743)";

const SCRIPT = `#!/bin/sh
dir=$(dirname "$0")
if [ "$(cat "$dir/deny" 2>/dev/null)" = "1" ]; then
  echo "${DENIED_MESSAGE}" >&2
  exit 1
fi
case "$1" in
  *ghostty-list.applescript) cat "$dir/terminals.tsv" ;;
  *ghostty-type.applescript) printf '%s\\t%s\\n' "$2" "$3" >> "$dir/typed.log" ;;
  *ghostty-close.applescript) printf '%s\\n' "$2" >> "$dir/closed.log" ;;
  *) echo "unknown script $1" >&2; exit 2 ;;
esac
`;

export type Terminal = { id: string; tty: string; pid: number; cwd: string };

export type FakeOsascript = {
  binary: string;
  setTerminals(terminals: Terminal[]): void;
  deny(): void;
  allow(): void;
  /** [text, terminalId] pairs the daemon asked to type. */
  typed(): string[][];
  closed(): string[];
};

function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.length > 0) : [];
}

export function createFakeOsascript(): FakeOsascript {
  const dir = makeTempDir("fdosa-");
  const binary = join(dir, "osascript");
  writeFileSync(binary, SCRIPT);
  chmodSync(binary, 0o755);
  writeFileSync(join(dir, "terminals.tsv"), "");
  return {
    binary,
    setTerminals(terminals): void {
      writeFileSync(join(dir, "terminals.tsv"), terminals.map((t) => [t.id, t.tty, String(t.pid), t.cwd].join("\t")).join("\n") + "\n");
    },
    deny: (): void => { writeFileSync(join(dir, "deny"), "1"); },
    allow: (): void => { writeFileSync(join(dir, "deny"), "0"); },
    typed: () => lines(join(dir, "typed.log")).map((line) => line.split("\t")),
    closed: () => lines(join(dir, "closed.log")),
  };
}
