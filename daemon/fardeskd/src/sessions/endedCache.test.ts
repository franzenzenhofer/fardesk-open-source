import { appendFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createEndedCache } from "./endedCache.js";
import type { TranscriptRef } from "./transcriptFiles.js";

const CWD = "/work/project";
const PAIRS = 6_000;
const OUTPUT = "x".repeat(600);

function rawLine(object: Record<string, unknown>, index: number): string {
  const timestamp = new Date(Date.parse("2026-11-15T12:00:00.000Z") + index * 1000).toISOString();
  return JSON.stringify({ uuid: `raw-${index}`, timestamp, isSidechain: false, cwd: CWD, ...object });
}

function toolPair(index: number): string {
  const id = `toolu_${index}`;
  const call = { type: "assistant", message: { role: "assistant", id: `msg-${index}`, model: "m", content: [{ type: "tool_use", id, name: "Bash", input: { command: `echo ${index}` } }] } };
  const result = { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: OUTPUT, is_error: false }] } };
  return `${rawLine(call, index * 2)}\n${rawLine(result, index * 2 + 1)}\n`;
}

function bigTranscript(path: string, pairs: number): void {
  const chunks: string[] = [rawLine({ type: "user", message: { role: "user", content: "go" } }, 0).concat("\n")];
  for (let index = 1; index <= pairs; index += 1) chunks.push(toolPair(index));
  writeFileSync(path, chunks.join(""));
}

function refOf(path: string): TranscriptRef {
  const stats = statSync(path);
  return { sessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", path, mtimeMs: stats.mtimeMs, sizeBytes: stats.size, projectDir: join(path, "..") };
}

function timed<T>(work: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = work();
  return { value, ms: performance.now() - start };
}

describe("ended session cache", () => {
  it("parses a multi-megabyte transcript once; repeat reads cost nothing (measured)", () => {
    const path = join(makeTempDir(), "big.jsonl");
    bigTranscript(path, PAIRS);
    const ref = refOf(path);
    expect(ref.sizeBytes).toBeGreaterThan(4_000_000);
    const cache = createEndedCache();
    const first = timed(() => cache.read(ref, CWD));
    const second = timed(() => cache.read(ref, CWD));
    process.stdout.write(`ended cache: ${ref.sizeBytes} B, first ${first.ms.toFixed(1)} ms, repeat ${second.ms.toFixed(3)} ms\n`);
    expect(second.value).toBe(first.value);
    expect(first.value.activities.length).toBeGreaterThan(PAIRS);
    expect(second.ms).toBeLessThan(first.ms / 20);
  });

  it("re-reads when the file grew or the folder changed", () => {
    const path = join(makeTempDir(), "grow.jsonl");
    bigTranscript(path, 5);
    const cache = createEndedCache();
    const before = cache.read(refOf(path), CWD);
    appendFileSync(path, toolPair(99));
    const after = cache.read(refOf(path), CWD);
    expect(after.activities.length).toBe(before.activities.length + 1);
    expect(cache.read(refOf(path), "/elsewhere")).not.toBe(after);
  });

  it("stays within its byte budget by dropping the least recently used transcript", () => {
    const dir = makeTempDir();
    const paths = ["a", "b", "c"].map((name) => join(dir, `${name}.jsonl`));
    for (const path of paths) bigTranscript(path, 50);
    const [a, b, c] = paths.map(refOf);
    if (a === undefined || b === undefined || c === undefined) throw new Error("refs missing");
    const cache = createEndedCache(a.sizeBytes * 2 + 10);
    const firstA = cache.read(a, CWD);
    cache.read(b, CWD);
    expect(cache.read(a, CWD)).toBe(firstA);
    cache.read(c, CWD);
    expect(cache.read(a, CWD)).toBe(firstA);
    expect(cache.read(b, CWD)).not.toBeUndefined();
  });

  it("does not keep a transcript bigger than the whole budget", () => {
    const path = join(makeTempDir(), "huge.jsonl");
    bigTranscript(path, 50);
    const ref = refOf(path);
    const cache = createEndedCache(ref.sizeBytes - 1);
    expect(cache.read(ref, CWD)).not.toBe(cache.read(ref, CWD));
  });
});
