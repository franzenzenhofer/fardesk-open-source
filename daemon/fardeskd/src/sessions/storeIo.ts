// How the session store reads transcripts: whole files for small ones, head + tail for big ended ones.
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { parseLine } from "../transcript/index.js";
import type { TranscriptLine } from "../transcript/index.js";
import { splitLines } from "../transcript/text.js";
import type { TranscriptRef } from "./transcriptFiles.js";
import { readTranscriptHead } from "./transcriptFiles.js";

export const FULL_READ_MAX_BYTES = 1_000_000;
export const HEAD_READ_BYTES = 200_000;
export const TAIL_READ_BYTES = 800_000;
const NEWLINE = "\n";

export function readWholeTranscript(path: string): TranscriptLine[] {
  return parseAll(splitLines(readFileSync(path, "utf8")));
}

function readTailText(path: string, size: number): string {
  const length = Math.min(size, TAIL_READ_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    const bytesRead = readSync(fd, buffer, 0, length, size - length);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    return text.slice(text.indexOf(NEWLINE) + 1);
  } finally {
    closeSync(fd);
  }
}

function parseAll(rawLines: string[]): TranscriptLine[] {
  return rawLines.flatMap((raw) => {
    const line = parseLine(raw);
    return line === null ? [] : [line];
  });
}

// Summaries of ended sessions only need the start (first prompt, start time) and the end (title, last reply).
export function readSummaryLines(ref: TranscriptRef): TranscriptLine[] {
  if (ref.sizeBytes <= FULL_READ_MAX_BYTES) return readWholeTranscript(ref.path);
  const head = readTranscriptHead(ref.path, HEAD_READ_BYTES);
  const tail = splitLines(readTailText(ref.path, ref.sizeBytes));
  return parseAll([...head, ...tail]);
}
