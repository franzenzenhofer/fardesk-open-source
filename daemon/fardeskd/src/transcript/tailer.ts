// Follows one transcript file: reads it whole once, then only the appended bytes on every poll.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { createParseStats, parseLine } from "./lineSchema.js";
import type { ParseStats, TranscriptLine } from "./lineTypes.js";
import { splitLines } from "./text.js";

const NEWLINE = 0x0a;

export type TailerDeps = { path: string; pollMs: number; onLines(lines: TranscriptLine[]): void };
export type Tailer = {
  lines(): TranscriptLine[];
  stats(): ParseStats;
  poll(): void;
  close(): void;
};

type ChunkParser = { feed(chunk: Buffer): TranscriptLine[]; reset(): void };

function isNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }
}

function readRange(path: string, from: number, to: number): Buffer {
  const buffer = Buffer.alloc(to - from);
  const fd = openSync(path, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(fd);
  }
}

// Only whole lines are parsed; an incomplete last line waits in `pending` for its newline.
function createChunkParser(stats: ParseStats): ChunkParser {
  let pending: Buffer = Buffer.alloc(0);
  const feed = (chunk: Buffer): TranscriptLine[] => {
    const data = Buffer.concat([pending, chunk]);
    const end = data.lastIndexOf(NEWLINE) + 1;
    pending = data.subarray(end);
    return splitLines(data.subarray(0, end).toString("utf8")).flatMap((raw) => {
      const line = parseLine(raw, stats);
      return line === null ? [] : [line];
    });
  };
  const reset = (): void => {
    pending = Buffer.alloc(0);
  };
  return { feed, reset };
}

type Follower = { lines: TranscriptLine[]; offset: number; parser: ChunkParser };

function readNew(path: string, size: number, follower: Follower): TranscriptLine[] {
  const chunk = readRange(path, follower.offset, size);
  const lines = follower.parser.feed(chunk);
  follower.offset += chunk.length;
  for (const line of lines) follower.lines.push(line);
  return lines;
}

// One poll: a shrunk or deleted file starts over, a grown one yields only the appended lines.
function pollOnce(deps: TailerDeps, follower: Follower): void {
  const size = fileSize(deps.path);
  if (size < follower.offset) {
    follower.lines = [];
    follower.offset = 0;
    follower.parser.reset();
  }
  if (size === follower.offset) return;
  const lines = readNew(deps.path, size, follower);
  if (lines.length > 0) deps.onLines(lines);
}

export function createTailer(deps: TailerDeps): Tailer {
  const stats = createParseStats();
  const follower: Follower = { lines: [], offset: 0, parser: createChunkParser(stats) };
  const initialSize = fileSize(deps.path);
  if (initialSize > 0) readNew(deps.path, initialSize, follower);
  const poll = (): void => {
    pollOnce(deps, follower);
  };
  const timer = setInterval(poll, deps.pollMs);
  return {
    lines: () => follower.lines,
    stats: () => stats,
    poll,
    close: (): void => {
      clearInterval(timer);
    },
  };
}
