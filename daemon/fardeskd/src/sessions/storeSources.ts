// What exists on disk right now: live processes from the registries, transcripts from the projects.
import { readClaudeRegistry } from "./claudeRegistry.js";
import type { LiveProcess } from "./claudeRegistry.js";
import { findTranscripts } from "./transcriptFiles.js";
import type { TranscriptRef } from "./transcriptFiles.js";

export type HomedProcess = { process: LiveProcess; home: string };

export function collectProcesses(claudeHomes: readonly string[]): Map<string, HomedProcess> {
  const byId = new Map<string, HomedProcess>();
  for (const home of claudeHomes) {
    for (const process of readClaudeRegistry(home).processes) {
      const known = byId.get(process.sessionId);
      if (known === undefined || known.process.updatedAt < process.updatedAt) byId.set(process.sessionId, { process, home });
    }
  }
  return byId;
}

// Every transcript of a live session, plus the newest `maxEnded` transcripts of sessions that ended.
export function collectTranscripts(
  claudeHomes: readonly string[],
  liveIds: ReadonlySet<string>,
  maxEnded: number,
): Map<string, TranscriptRef> {
  const newestFirst = claudeHomes.flatMap(findTranscripts).sort((a, b) => b.mtimeMs - a.mtimeMs);
  const kept = new Map<string, TranscriptRef>();
  let ended = 0;
  for (const ref of newestFirst) {
    if (kept.has(ref.sessionId)) continue;
    if (!liveIds.has(ref.sessionId)) {
      if (ended >= maxEnded) continue;
      ended += 1;
    }
    kept.set(ref.sessionId, ref);
  }
  return kept;
}
