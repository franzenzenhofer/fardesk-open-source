import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { canonicalPath, configDirsOfRunningClaude, discoverClaudeHomes, hasClaudeLayout } from "./discover.js";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const noProcesses = (): Promise<string> => Promise.resolve("");

function homeWithRegistry(dir: string): string {
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "sessions", "4242.json"), "{}");
  return dir;
}

function homeWithTranscript(dir: string): string {
  mkdirSync(join(dir, "projects", "-work-project"), { recursive: true });
  writeFileSync(join(dir, "projects", "-work-project", `${SESSION_ID}.jsonl`), "");
  return dir;
}

describe("hasClaudeLayout", () => {
  it("accepts registry files and transcripts, and nothing that only has a similar name", () => {
    const root = makeTempDir();
    expect(hasClaudeLayout(homeWithRegistry(join(root, "a")))).toBe(true);
    expect(hasClaudeLayout(homeWithTranscript(join(root, "b")))).toBe(true);
    mkdirSync(join(root, "empty", "sessions"), { recursive: true });
    mkdirSync(join(root, "empty", "projects"), { recursive: true });
    expect(hasClaudeLayout(join(root, "empty"))).toBe(false);
    mkdirSync(join(root, "notes", "sessions"), { recursive: true });
    writeFileSync(join(root, "notes", "sessions", "agenda.txt"), "");
    expect(hasClaudeLayout(join(root, "notes"))).toBe(false);
    expect(hasClaudeLayout(join(root, "missing"))).toBe(false);
  });
});

describe("discoverClaudeHomes", () => {
  it("finds the folders directly in the home that have the layout and skips look-alikes", async () => {
    const home = makeTempDir();
    homeWithRegistry(join(home, ".claude"));
    homeWithTranscript(join(home, ".claude-other"));
    mkdirSync(join(home, "lookalike", "sessions"), { recursive: true });
    homeWithRegistry(join(home, "deep", "nested"));
    writeFileSync(join(home, "plain-file"), "");
    const found = await discoverClaudeHomes({ home, run: noProcesses });
    expect(found).toEqual([
      { path: join(home, ".claude"), sources: ["folder"] },
      { path: join(home, ".claude-other"), sources: ["folder"] },
    ]);
  });

  it("adds the CLAUDE_CONFIG_DIR of running claude processes, once, and merges both sources", async () => {
    const home = makeTempDir();
    const elsewhere = makeTempDir();
    const inHome = homeWithRegistry(join(home, ".claude-team"));
    const ps = [
      `  101 /usr/local/bin/claude --resume PATH=/usr/bin CLAUDE_CONFIG_DIR=${elsewhere} TERM=xterm`,
      `  102 /usr/local/bin/claude CLAUDE_CONFIG_DIR=${elsewhere}`,
      `  103 /usr/local/bin/claude HOME=/x CLAUDE_CONFIG_DIR=${inHome}`,
      `  104 /bin/zsh CLAUDE_CONFIG_DIR=${join(home, "from-a-shell")}`,
      `  105 /usr/local/bin/claude CLAUDE_CONFIG_DIR=${join(home, "deleted-home")}`,
      "  106 /usr/local/bin/claude TERM=xterm",
    ].join("\n");
    const found = await discoverClaudeHomes({ home, run: () => Promise.resolve(ps) });
    expect(found).toEqual([
      { path: elsewhere, sources: ["process"] },
      { path: inHome, sources: ["folder", "process"] },
    ].sort((a, b) => a.path.localeCompare(b.path)));
  });

  it("finds a home that is a symlinked folder and merges it with the process that names its target", async () => {
    const home = makeTempDir();
    const target = homeWithRegistry(join(makeTempDir(), "real-home"));
    const link = join(home, ".claude-linked");
    symlinkSync(target, link);
    const found = await discoverClaudeHomes({ home, run: () => Promise.resolve(`  101 /usr/local/bin/claude CLAUDE_CONFIG_DIR=${target}`) });
    expect(found).toEqual([{ path: link, sources: ["folder", "process"] }]);
    expect(canonicalPath(link)).toBe(canonicalPath(target));
  });

  it("scans no folder when there is no home folder, and still reads the processes", async () => {
    const elsewhere = makeTempDir();
    const found = await discoverClaudeHomes({ home: null, run: () => Promise.resolve(`  101 /usr/local/bin/claude CLAUDE_CONFIG_DIR=${elsewhere}`) });
    expect(found).toEqual([{ path: elsewhere, sources: ["process"] }]);
  });

  it("reports nothing from processes when ps cannot be run", async () => {
    const failing = (): Promise<string> => Promise.reject(new Error("ps: not found"));
    expect(await configDirsOfRunningClaude(failing)).toEqual([]);
    expect(await discoverClaudeHomes({ home: makeTempDir(), run: failing })).toEqual([]);
  });
});
