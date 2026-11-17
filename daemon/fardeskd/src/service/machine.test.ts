import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { runCommand } from "../config/bind.js";
import { FardeskError } from "../core/errors.js";
import { createLogger } from "../core/log.js";
import { readClaudeVersion, readDaemonVersion, resolveOs } from "./machine.js";

function script(body: string): string {
  const path = join(makeTempDir(), "claude");
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

function logger(): { lines: string[]; log: ReturnType<typeof createLogger> } {
  const lines: string[] = [];
  return { lines, log: createLogger((line) => lines.push(line), () => new Date()) };
}

describe("resolveOs", () => {
  it("maps darwin and linux and refuses everything else", () => {
    expect(resolveOs("darwin")).toBe("macos");
    expect(resolveOs("linux")).toBe("linux");
    expect(() => resolveOs("win32")).toThrow(FardeskError);
    expect(() => resolveOs("win32")).toThrow(/win32/);
  });
});

describe("readDaemonVersion", () => {
  it("is the version in package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };
    expect(readDaemonVersion()).toBe(pkg.version);
  });
});

describe("readClaudeVersion", () => {
  it("keeps the first word of the --version output", async () => {
    const { log } = logger();
    expect(await readClaudeVersion(script('echo "9.9.9 (Claude Code)"'), runCommand, log)).toBe("9.9.9");
  });

  it("is null for empty output, and for a binary that fails or does not exist, with a warning", async () => {
    const { log, lines } = logger();
    expect(await readClaudeVersion(script("true"), runCommand, log)).toBeNull();
    expect(lines).toEqual([]);
    expect(await readClaudeVersion(script("echo broken >&2; exit 3"), runCommand, log)).toBeNull();
    expect(await readClaudeVersion("/nonexistent/claude", runCommand, log)).toBeNull();
    expect(lines.filter((line) => line.includes("claude_version_unavailable"))).toHaveLength(2);
  });
});
