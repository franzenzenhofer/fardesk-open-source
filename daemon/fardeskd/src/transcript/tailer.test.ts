import { appendFileSync, rmSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { makeTempFile, titleLine } from "../../test/support/transcriptLines.js";
import type { TranscriptLine } from "./lineTypes.js";
import { createTailer } from "./tailer.js";

const SLOW_POLL_MS = 60_000;
const FAST_POLL_MS = 10;

function collector(): { batches: TranscriptLine[][]; onLines: (lines: TranscriptLine[]) => void } {
  const batches: TranscriptLine[][] = [];
  return {
    batches,
    onLines: (lines): void => {
      batches.push(lines);
    },
  };
}

const titles = (lines: TranscriptLine[]): string[] => lines.map((line) => (line.type === "title" ? line.title : line.type));

describe("createTailer", () => {
  it("reads the whole existing file once, without announcing it as new lines", () => {
    const path = makeTempFile(`${titleLine("a")}\n${JSON.stringify({ type: "attachment" })}\n\nnot json\n${titleLine("b")}\n`);
    const seen = collector();
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: seen.onLines });
    expect(titles(tailer.lines())).toEqual(["a", "b"]);
    expect(tailer.stats()).toEqual({ parsed: 2, blank: 1, invalid: 1, skipped: 1 });
    expect(seen.batches).toEqual([]);
    tailer.close();
  });

  it("reads only the appended bytes on every poll and announces non-empty batches", () => {
    const path = makeTempFile(`${titleLine("a")}\n`);
    const seen = collector();
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: seen.onLines });
    tailer.poll();
    expect(seen.batches).toEqual([]);
    appendFileSync(path, `${titleLine("b")}\n${titleLine("c")}\n`);
    tailer.poll();
    expect(seen.batches.map(titles)).toEqual([["b", "c"]]);
    expect(titles(tailer.lines())).toEqual(["a", "b", "c"]);
    appendFileSync(path, `${JSON.stringify({ type: "attachment" })}\n`);
    tailer.poll();
    expect(seen.batches).toHaveLength(1);
    tailer.close();
  });

  it("keeps an incomplete last line buffered until its newline arrives", () => {
    const path = makeTempFile("");
    const seen = collector();
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: seen.onLines });
    const whole = titleLine("half");
    appendFileSync(path, whole.slice(0, 10));
    tailer.poll();
    expect(tailer.lines()).toEqual([]);
    appendFileSync(path, `${whole.slice(10)}\n${titleLine("next").slice(0, 5)}`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["half"]);
    appendFileSync(path, `${titleLine("next").slice(5)}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["half", "next"]);
    expect(tailer.stats().invalid).toBe(0);
    tailer.close();
  });

  it("keeps an incomplete line that was already there when it started", () => {
    const whole = titleLine("late");
    const path = makeTempFile(`${titleLine("a")}\n${whole.slice(0, 12)}`);
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: () => undefined });
    expect(titles(tailer.lines())).toEqual(["a"]);
    appendFileSync(path, `${whole.slice(12)}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["a", "late"]);
    tailer.close();
  });

  it("does not split a multi-byte character written in two halves", () => {
    const path = makeTempFile("");
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: () => undefined });
    const bytes = Buffer.from(`${titleLine("café ✓")}\n`, "utf8");
    const cut = bytes.indexOf(0xc3) + 1;
    appendFileSync(path, bytes.subarray(0, cut));
    tailer.poll();
    appendFileSync(path, bytes.subarray(cut));
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["café ✓"]);
    tailer.close();
  });

  it("resets and re-reads when the file shrinks", () => {
    const path = makeTempFile(`${titleLine("old one")}\n${titleLine("old two")}\n`);
    const seen = collector();
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: seen.onLines });
    writeFileSync(path, `${titleLine("new")}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["new"]);
    expect(seen.batches.map(titles)).toEqual([["new"]]);
    tailer.close();
  });

  it("drops a partial line when the file shrinks", () => {
    const path = makeTempFile(`${titleLine("a")}\n${titleLine("partial").slice(0, 8)}`);
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: () => undefined });
    writeFileSync(path, `${titleLine("b")}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["b"]);
    tailer.close();
  });

  it("tolerates a file that does not exist yet and one that is deleted", () => {
    const path = makeTempFile("", "later.jsonl");
    rmSync(path);
    const seen = collector();
    const tailer = createTailer({ path, pollMs: SLOW_POLL_MS, onLines: seen.onLines });
    tailer.poll();
    expect(tailer.lines()).toEqual([]);
    writeFileSync(path, `${titleLine("born")}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["born"]);
    rmSync(path);
    tailer.poll();
    expect(tailer.lines()).toEqual([]);
    writeFileSync(path, `${titleLine("reborn")}\n`);
    tailer.poll();
    expect(titles(tailer.lines())).toEqual(["reborn"]);
    expect(seen.batches.map(titles)).toEqual([["born"], ["reborn"]]);
    tailer.close();
  });

  it("follows the file on its own timer until closed", async () => {
    const path = makeTempFile(`${titleLine("a")}\n`);
    const seen = collector();
    const tailer = createTailer({ path, pollMs: FAST_POLL_MS, onLines: seen.onLines });
    appendFileSync(path, `${titleLine("b")}\n`);
    await waitUntil(() => seen.batches.length === 1);
    tailer.close();
    appendFileSync(path, `${titleLine("c")}\n`);
    await sleep(FAST_POLL_MS * 6);
    expect(seen.batches.map(titles)).toEqual([["b"]]);
  });

  it("fails loudly when the path is a directory", () => {
    expect(() => createTailer({ path: makeTempDir(), pollMs: SLOW_POLL_MS, onLines: () => undefined })).toThrow(/EISDIR/);
  });

  it("fails loudly when the file cannot be inspected for any reason other than not existing", () => {
    const notADirectory = makeTempFile("x");
    expect(() => createTailer({ path: `${notADirectory}/child.jsonl`, pollMs: SLOW_POLL_MS, onLines: () => undefined })).toThrow(/ENOTDIR/);
  });
});
