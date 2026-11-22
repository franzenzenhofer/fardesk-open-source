import { mkdirSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { findTranscripts, readTranscriptHead } from "./transcriptFiles.js";

const ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECONDS_OLD = 1_700_000_000;

function project(home: string, name: string): string {
  const dir = join(home, "projects", name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("findTranscripts", () => {
  it("lists uuid jsonl files one level deep, newest first, with size and project dir", () => {
    const home = makeTempDir();
    const dir1 = project(home, "-Users-dev-alpha");
    const dir2 = project(home, "-Users-dev-beta");
    writeFileSync(join(dir1, `${ID_A}.jsonl`), "12345");
    writeFileSync(join(dir2, `${ID_B}.jsonl`), "1234567890");
    utimesSync(join(dir1, `${ID_A}.jsonl`), SECONDS_OLD, SECONDS_OLD);
    utimesSync(join(dir2, `${ID_B}.jsonl`), SECONDS_OLD + 100, SECONDS_OLD + 100);
    const refs = findTranscripts(home);
    expect(refs).toEqual([
      { sessionId: ID_B, path: join(dir2, `${ID_B}.jsonl`), mtimeMs: (SECONDS_OLD + 100) * 1000, sizeBytes: 10, projectDir: dir2, home },
      { sessionId: ID_A, path: join(dir1, `${ID_A}.jsonl`), mtimeMs: SECONDS_OLD * 1000, sizeBytes: 5, projectDir: dir1, home },
    ]);
  });

  it("ignores nested subagent transcripts, other files and stray files in projects", () => {
    const home = makeTempDir();
    const dir = project(home, "-Users-dev-alpha");
    const nested = join(dir, ID_A, "subagents");
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, `${ID_B}.jsonl`), "x");
    writeFileSync(join(dir, "notes.jsonl"), "x");
    writeFileSync(join(dir, `${ID_A}.json`), "x");
    mkdirSync(join(dir, `${ID_B}.jsonl`));
    writeFileSync(join(home, "projects", `${ID_A}.jsonl`), "x");
    expect(findTranscripts(home)).toEqual([]);
  });

  it("returns an empty list when projects is missing", () => {
    expect(findTranscripts(makeTempDir())).toEqual([]);
  });

  it("skips a file that vanishes before it can be examined", () => {
    const home = makeTempDir();
    const dir = project(home, "-Users-dev-alpha");
    symlinkSync(join(dir, "gone"), join(dir, `${ID_A}.jsonl`));
    expect(findTranscripts(home)).toEqual([]);
  });

  it("ignores a symlink that points to a directory", () => {
    const home = makeTempDir();
    const dir = project(home, "-Users-dev-alpha");
    symlinkSync(dir, join(dir, `${ID_A}.jsonl`));
    expect(findTranscripts(home)).toEqual([]);
  });

  it("rethrows unexpected stat errors", () => {
    const home = makeTempDir();
    const dir = project(home, "-Users-dev-alpha");
    symlinkSync(join(dir, `${ID_A}.jsonl`), join(dir, `${ID_A}.jsonl`));
    expect(() => findTranscripts(home)).toThrow(/ELOOP/);
  });

  it("rethrows unexpected errors", () => {
    const home = makeTempDir();
    writeFileSync(join(home, "projects"), "not a dir");
    expect(() => findTranscripts(home)).toThrow(/ENOTDIR/);
  });
});

describe("readTranscriptHead", () => {
  it("returns all lines of a small file", () => {
    const path = join(makeTempDir(), "t.jsonl");
    writeFileSync(path, '{"a":1}\n{"b":2}\n');
    expect(readTranscriptHead(path, 1000)).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("returns only complete lines inside the first maxBytes of a larger file", () => {
    const path = join(makeTempDir(), "t.jsonl");
    writeFileSync(path, "line-one\nline-two\nline-three\n");
    expect(readTranscriptHead(path, 12)).toEqual(["line-one"]);
    expect(readTranscriptHead(path, 18)).toEqual(["line-one", "line-two"]);
  });

  it("drops a partial last line without a newline", () => {
    const dir = makeTempDir();
    const partial = join(dir, "p.jsonl");
    writeFileSync(partial, 'full\n{"half":');
    expect(readTranscriptHead(partial, 1000)).toEqual(["full"]);
    expect(readTranscriptHead(partial, 1000)).not.toContain('{"half":');
  });

  it("returns an empty list for an empty file and for a file with no newline within the limit", () => {
    const dir = makeTempDir();
    const empty = join(dir, "e.jsonl");
    writeFileSync(empty, "");
    expect(readTranscriptHead(empty, 100)).toEqual([]);
    const long = join(dir, "l.jsonl");
    writeFileSync(long, "x".repeat(50));
    expect(readTranscriptHead(long, 10)).toEqual([]);
  });

  it("fails loudly when the file does not exist", () => {
    expect(() => readTranscriptHead(join(makeTempDir(), "missing.jsonl"), 10)).toThrow(/ENOENT/);
  });
});

