// One tracked session inside the store, the store's dependencies, and the pure helpers on entries.
import type { Activity, SessionSummary } from "../contract/schema.js";
import type { Bus } from "../core/bus.js";
import type { Logger } from "../core/log.js";
import type { Tailer, TranscriptSummary } from "../transcript/index.js";
import type { LiveProcess } from "./claudeRegistry.js";
import type { EndedCache } from "./endedCache.js";
import type { PendingKind } from "./status.js";
import type { TranscriptRef } from "./transcriptFiles.js";

export type StoreDeps = {
  claudeHomes: string[];
  bus: Bus;
  log: Logger;
  registryPollMs: number;
  transcriptPollMs: number;
  summaryMaxChars: number;
  limits: { maxEnded: number; maxEndedReadsPerRefresh: number; maxFolders: number };
  isOwned(sessionId: string): boolean;
  isBusy(sessionId: string): boolean;
  pendingKind(sessionId: string): PendingKind | null;
  isMuted(sessionId: string): boolean;
  /** The terminal of this process can be typed into (tmux pane or Ghostty terminal): replies need no inbox. */
  isTypable?(pid: number): boolean;
  onLeftWaiting(sessionId: string): void;
};

export type StoreEntry = {
  id: string;
  process: LiveProcess | null;
  home: string | null;
  ref: TranscriptRef | null;
  summary: TranscriptSummary | null;
  cacheKey: string | null;
  tailer: Tailer | null;
  tailerPath: string | null;
  activities: Activity[];
  wasWaiting: boolean;
  published: string | null;
  current: SessionSummary | null;
};

export type StoreContext = {
  deps: StoreDeps;
  entries: Map<string, StoreEntry>;
  acceptingHomes: Set<string>;
  ended: EndedCache;
};

export const EMPTY_SUMMARY: TranscriptSummary = {
  title: null,
  summary: "",
  cwd: null,
  model: null,
  permissionMode: null,
  startedAt: null,
  updatedAt: null,
  pendingToolUse: false,
  contextTokens: null,
  cacheExpiresAt: null,
};

export function newEntry(id: string): StoreEntry {
  return {
    id,
    process: null,
    home: null,
    ref: null,
    summary: null,
    cacheKey: null,
    tailer: null,
    tailerPath: null,
    activities: [],
    wasWaiting: false,
    published: null,
    current: null,
  };
}

export function cacheKeyOf(ref: TranscriptRef): string {
  return `${ref.mtimeMs}:${ref.sizeBytes}`;
}

// The rows of `next` that are new or changed compared with `previous` (matched by id).
export function diffActivities(previous: readonly Activity[], next: readonly Activity[]): Activity[] {
  const known = new Map(previous.map((activity) => [activity.id, JSON.stringify(activity)]));
  return next.filter((activity) => known.get(activity.id) !== JSON.stringify(activity));
}
