// Guard: the daemon starts external processes in one place only, src/config/bind.ts, where every call has a hard
// deadline. A second place could start a tool without one; on 2026-11-21 deadline-less `ps` calls piled up to the
// process limit and starved the machine. This test fails the build when any other source file imports child_process.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const ALLOWED = new Set(["config/bind.ts"]);
const CHILD_PROCESS = /from\s+["'](node:)?child_process["']|require\(\s*["'](node:)?child_process["']\s*\)/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("process guard", () => {
  it("only src/config/bind.ts starts processes, so every external tool has a deadline", () => {
    const offenders = sourceFiles(SRC)
      .map((path) => relative(SRC, path))
      .filter((path) => !ALLOWED.has(path) && CHILD_PROCESS.test(readFileSync(join(SRC, path), "utf8")));
    expect(offenders).toEqual([]);
  });
});
