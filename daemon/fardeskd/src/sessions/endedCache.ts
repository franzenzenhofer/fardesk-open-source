// Parsed transcripts of ended sessions, so opening, paging and detail taps do not re-read and re-parse the
// whole file each time. Keyed by path and validated by mtime + size + cwd; bounded by the bytes of the files.
import { mapActivities } from "../transcript/index.js";
import type { TranscriptLine } from "../transcript/index.js";
import type { Activity } from "../contract/schema.js";
import { readWholeTranscript } from "./storeIo.js";
import type { TranscriptRef } from "./transcriptFiles.js";

export const ENDED_CACHE_MAX_BYTES = 64_000_000;

export type ParsedTranscript = { lines: TranscriptLine[]; activities: Activity[] };

type Cached = ParsedTranscript & { key: string; sizeBytes: number };

export type EndedCache = { read(ref: TranscriptRef, cwd: string): ParsedTranscript };

const keyOf = (ref: TranscriptRef, cwd: string): string => `${ref.mtimeMs}:${ref.sizeBytes}:${cwd}`;

export function createEndedCache(maxBytes: number = ENDED_CACHE_MAX_BYTES): EndedCache {
  // Map order is recency: the first key is the least recently used.
  const entries = new Map<string, Cached>();
  const totalBytes = (): number => [...entries.values()].reduce((sum, cached) => sum + cached.sizeBytes, 0);
  const evict = (): void => {
    for (const path of entries.keys()) {
      if (totalBytes() <= maxBytes) return;
      entries.delete(path);
    }
  };
  return {
    read(ref, cwd): ParsedTranscript {
      const key = keyOf(ref, cwd);
      const hit = entries.get(ref.path);
      if (hit?.key === key) {
        entries.delete(ref.path);
        entries.set(ref.path, hit);
        return hit;
      }
      entries.delete(ref.path);
      const lines = readWholeTranscript(ref.path);
      const parsed: Cached = { lines, activities: mapActivities(lines, { cwd }), key, sizeBytes: ref.sizeBytes };
      if (ref.sizeBytes <= maxBytes) {
        entries.set(ref.path, parsed);
        evict();
      }
      return parsed;
    },
  };
}
