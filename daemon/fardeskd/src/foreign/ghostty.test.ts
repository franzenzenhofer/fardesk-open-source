// Matching logic on a real `ps -A -o pid=,ppid=,tty=,comm=` capture (test/fixtures/ps/ghostty-tabs.txt, Ghostty 1.4.0 on macOS),
// and the AppleScript sources checked by the real compiler. The terminal listing format is our own script's output
// (id TAB tty TAB pid TAB cwd), shaped from the sdef of Ghostty 1.4.0 because listing real terminals can open a consent dialog.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturePath, makeTempDir } from "../../test/support/env.js";
import { SCRIPTS, installScripts } from "./ghosttyScripts.js";
import { hostedByGhostty, matchTerminal, parseTerminalList } from "./ghostty.js";
import { parseProcessTable } from "./processTree.js";
import { findTabShell } from "./terminalTab.js";

const table = parseProcessTable(readFileSync(fixturePath("ps", "ghostty-tabs.txt"), "utf8"));
const CLAUDE_TTYS000 = 47748;
const CLAUDE_TTYS001 = 25870;
const LISTING = [
  ["7C1F0E2A-0000-4000-8000-000000000001", "/dev/ttys000", "47748", "/Users/dev/alpha"],
  ["7C1F0E2A-0000-4000-8000-000000000002", "/dev/ttys001", "25870", "/Users/dev/beta"],
  ["7C1F0E2A-0000-4000-8000-000000000003", "/dev/ttys002", "38521", "/Users/dev/gamma with\ttab"],
]
  .map((fields) => fields.join("\t"))
  .join("\n");

describe("process table with tty (real capture)", () => {
  it("reads the tty column and the whole login chain", () => {
    expect(table.get(CLAUDE_TTYS000)).toMatchObject({ ppid: 43728, tty: "ttys000" });
    expect(table.get(689)?.tty).toBe("??");
    expect(table.get(43728)?.command).toBe("-/bin/zsh");
  });

  it("sees a Ghostty ancestor, and finds the login shell of the tab as the tab shell", () => {
    expect(hostedByGhostty(table, CLAUDE_TTYS000)).toBe(true);
    expect(hostedByGhostty(table, 18788)).toBe(true);
    expect(hostedByGhostty(table, 1)).toBe(false);
    expect(findTabShell(table, CLAUDE_TTYS000)?.pid).toBe(43728);
  });
});

describe("terminal listing and matching", () => {
  const terminals = parseTerminalList(LISTING);

  it("parses id, tty, pid and a working directory that itself contains a tab", () => {
    expect(terminals).toHaveLength(3);
    expect(terminals[2]).toEqual({ id: "7C1F0E2A-0000-4000-8000-000000000003", tty: "/dev/ttys002", pid: 38521, cwd: "/Users/dev/gamma with\ttab" });
    expect(parseTerminalList("garbage\n\n a\tb\n")).toEqual([]);
  });

  it("matches the session's claude process to the terminal with the same tty", () => {
    expect(matchTerminal(table, CLAUDE_TTYS000, terminals)?.id).toBe("7C1F0E2A-0000-4000-8000-000000000001");
    expect(matchTerminal(table, CLAUDE_TTYS001, terminals)?.id).toBe("7C1F0E2A-0000-4000-8000-000000000002");
  });

  it("matches a child of claude through the same tty (a tool process on the tab)", () => {
    expect(matchTerminal(table, 47790, terminals)?.id).toBe("7C1F0E2A-0000-4000-8000-000000000001");
  });

  it("never matches a process whose terminal is not listed, or an unknown pid", () => {
    expect(matchTerminal(table, CLAUDE_TTYS000, terminals.slice(1))).toBeNull();
    expect(matchTerminal(table, 999_999, terminals)).toBeNull();
    expect(matchTerminal(table, CLAUDE_TTYS000, [])).toBeNull();
  });

  it("falls back to the terminal's foreground process being the session process or its descendant, never its ancestor, when the process has no tty, and refuses ambiguity", () => {
    const noTty = parseProcessTable("100 1 ?? /Applications/Ghostty.app/Contents/MacOS/ghostty\n200 100 ?? claude\n300 200 ?? sleep\n");
    const one = [{ id: "A", tty: "/dev/ttys9", pid: 300, cwd: "/x" }];
    expect(matchTerminal(noTty, 200, one)?.id).toBe("A");
    expect(matchTerminal(noTty, 200, [...one, { id: "B", tty: "/dev/ttys8", pid: 200, cwd: "/y" }])).toBeNull();
    expect(matchTerminal(noTty, 300, [{ id: "C", tty: "/dev/ttys7", pid: 200, cwd: "/z" }])).toBeNull();
  });

  it("refuses two terminals on one tty", () => {
    const twice = [...terminals, { ...(terminals[0] ?? { id: "", tty: "", pid: 1, cwd: "" }), id: "dup" }];
    expect(matchTerminal(table, CLAUDE_TTYS000, twice)).toBeNull();
  });
});

describe.skipIf(process.platform !== "darwin")("AppleScript sources", () => {
  it("compile with the real AppleScript compiler against Ghostty's dictionary", () => {
    const dir = makeTempDir("fdas-");
    const paths = installScripts(dir);
    for (const name of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
      const out = join(dir, `${name}.scpt`);
      execFileSync("osacompile", ["-o", out, paths[name]], { stdio: "pipe" });
      expect(readFileSync(paths[name], "utf8")).toBe(SCRIPTS[name]);
    }
  });

  it("take text and terminal id only through argv", () => {
    expect(SCRIPTS.type).toContain("item 1 of argv");
    expect(SCRIPTS.type).not.toMatch(/-e\b/);
  });
});
