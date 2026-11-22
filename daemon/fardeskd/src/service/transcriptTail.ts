// Reading what a running Claude Code session appends to its transcript after a given point.
import { closeSync, openSync, readSync, statSync } from "node:fs";

const NEWLINE = "\n";

export function sizeOf(path: string | null): number {
  return path === null ? 0 : statSync(path).size;
}

/** The lines appended to a transcript after `offset` bytes. */
export function readAppended(path: string, offset: number): string[] {
  const length = statSync(path).size - offset;
  if (length <= 0) return [];
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, length, offset)).toString("utf8").split(NEWLINE);
  } finally {
    closeSync(fd);
  }
}
