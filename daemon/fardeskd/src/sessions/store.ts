// The session store: live processes (registry) + transcripts -> contract SessionSummary, kept current
// by a poll cycle, per-session transcript tailers and overlay readers (owned, busy, pending, muted).
import type { Activity, RecentFolders, SessionStatus, SessionSummary } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { TranscriptLine } from "../transcript/index.js";
import type { LiveProcess } from "./claudeRegistry.js";
import type { PendingKind } from "./status.js";
import { createEndedCache } from "./endedCache.js";
import { publishEntry, refreshStore, stopTailer } from "./storeCycle.js";
import type { StoreContext, StoreDeps, StoreEntry } from "./storeEntry.js";

const STATUS_ORDER: Record<SessionStatus, number> = { waiting: 0, working: 1, idle: 2, ended: 3 };

export type { PendingKind, StoreDeps };

export type SessionRecord = {
  summary: SessionSummary;
  transcriptPath: string | null;
  process: LiveProcess | null;
  permissionMode: string | null;
};

export type SessionStore = {
  list(): SessionSummary[];
  find(sessionId: string): SessionRecord | undefined;
  get(sessionId: string): SessionRecord;
  activities(sessionId: string): Activity[];
  lines(sessionId: string): TranscriptLine[];
  recentFolders(): RecentFolders;
  recompute(sessionId: string): void;
  refresh(): void;
  close(): void;
};

type Visible = StoreEntry & { current: SessionSummary };

const byNewest = (a: SessionSummary, b: SessionSummary): number => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
const byOrder = (a: SessionSummary, b: SessionSummary): number => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || byNewest(a, b);
const isVisible = (entry: StoreEntry | undefined): entry is Visible => entry?.current != null;

function recordOf(entry: Visible): SessionRecord {
  const { current: summary, ref, process } = entry;
  return { summary, transcriptPath: ref?.path ?? null, process, permissionMode: entry.summary?.permissionMode ?? null };
}

function visible(ctx: StoreContext, sessionId: string): Visible {
  const entry = ctx.entries.get(sessionId);
  if (!isVisible(entry)) throw new FardeskError("not_found", `no session ${sessionId}`);
  return entry;
}

function linesOf(ctx: StoreContext, entry: Visible): TranscriptLine[] {
  if (entry.tailer !== null) return entry.tailer.lines();
  return entry.ref === null ? [] : ctx.ended.read(entry.ref, entry.current.cwd).lines;
}

function summaries(ctx: StoreContext): SessionSummary[] {
  return [...ctx.entries.values()].flatMap((entry) => (entry.current === null ? [] : [entry.current]));
}

function activitiesOf(ctx: StoreContext, sessionId: string): Activity[] {
  const entry = visible(ctx, sessionId);
  if (entry.tailer !== null) return entry.activities;
  return entry.ref === null ? [] : ctx.ended.read(entry.ref, entry.current.cwd).activities;
}

function recentFoldersOf(ctx: StoreContext): RecentFolders {
  const seen = new Set<string>();
  const folders = summaries(ctx)
    .sort(byNewest)
    .filter((session) => !seen.has(session.cwd) && seen.add(session.cwd))
    .slice(0, ctx.deps.limits.maxFolders)
    .map((session) => ({ path: session.cwd, lastUsedAt: session.updatedAt }));
  return { folders };
}

function startPolling(ctx: StoreContext): () => void {
  const { deps } = ctx;
  const refresh = (): void => {
    try {
      refreshStore(ctx);
    } catch (error) {
      deps.log.error("session_refresh_failed", { error: String(error) });
    }
  };
  const unsubscribe = deps.bus.subscribe((event) => {
    if (event.type !== "activity" || (event.activity.kind !== "permission" && event.activity.kind !== "question")) return;
    const entry = ctx.entries.get(event.sessionId);
    if (entry !== undefined) publishEntry(ctx, entry);
  });
  const timer = setInterval(refresh, deps.registryPollMs);
  timer.unref();
  return (): void => {
    clearInterval(timer);
    unsubscribe();
  };
}

export function createSessionStore(deps: StoreDeps): SessionStore {
  const ctx: StoreContext = { deps, entries: new Map(), acceptingHomes: new Set(), ended: createEndedCache() };
  refreshStore(ctx);
  const stopPolling = startPolling(ctx);
  return {
    list: (): SessionSummary[] => summaries(ctx).sort(byOrder),
    find(sessionId): SessionRecord | undefined {
      const entry = ctx.entries.get(sessionId);
      return isVisible(entry) ? recordOf(entry) : undefined;
    },
    get: (sessionId): SessionRecord => recordOf(visible(ctx, sessionId)),
    activities: (sessionId): Activity[] => activitiesOf(ctx, sessionId),
    lines: (sessionId): TranscriptLine[] => linesOf(ctx, visible(ctx, sessionId)),
    recentFolders: (): RecentFolders => recentFoldersOf(ctx),
    recompute(sessionId): void {
      const entry = ctx.entries.get(sessionId);
      if (entry !== undefined) publishEntry(ctx, entry);
    },
    refresh: (): void => {
      refreshStore(ctx);
    },
    close(): void {
      stopPolling();
      for (const entry of ctx.entries.values()) stopTailer(entry);
    },
  };
}
