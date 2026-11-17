// What the hub remembers of one peer: its machine, its sessions and the latest activity rows of some sessions.
import type { Activity, ActivityPage, Machine, SessionSummary, StreamEvent } from "../contract/schema.js";
import { BROKER_ID_PREFIX } from "../permissions/broker.js";

export const MAX_CACHED_ROWS = 200;

type Feed = { rows: Activity[]; hasMore: boolean };

export type PeerCache = {
  machine(): Machine | null;
  setMachine(machine: Machine): void;
  sessions(): SessionSummary[];
  /** Applies one upstream stream event (hello replaces everything the stream told us before). */
  apply(event: StreamEvent): void;
  /** The newest `limit` cached rows of the session, or null when no page of it was fetched yet. */
  page(sessionId: string, limit: number): ActivityPage | null;
  seed(sessionId: string, page: ActivityPage): void;
  /**
   * Takes the peer's own session list, read over HTTP from `readStartedAt` on (ms epoch), into the cache (feeds stay).
   * The stream never says that a session went away, so without this the hub keeps stale sessions "working" forever.
   * A session the stream touched after the read started is newer than the snapshot and is never overwritten or dropped by it.
   */
  reconcileSessions(sessions: SessionSummary[], readStartedAt: number): SessionDiff;
};

/** none: nothing to tell clients. changed: only these sessions are new or differ (send them one by one). removed: a session left the list, so clients need the whole list (a hello). */
export type SessionDiff =
  | { kind: "none" }
  | { kind: "changed"; sessions: SessionSummary[] }
  | { kind: "removed"; sessions: SessionSummary[] };

type State = { machine: Machine | null; sessions: Map<string, SessionSummary>; feeds: Map<string, Feed>; touched: Map<string, number> };

const isNewerThanRead = (state: State, id: string, readStartedAt: number): boolean => (state.touched.get(id) ?? 0) >= readStartedAt;

function differs(current: SessionSummary | undefined, next: SessionSummary): boolean {
  return current === undefined || JSON.stringify(current) !== JSON.stringify(next);
}

function reconcile(state: State, next: SessionSummary[], readStartedAt: number): SessionDiff {
  const listed = new Set(next.map((session) => session.id));
  const removed = [...state.sessions.keys()].filter((id) => !listed.has(id) && !isNewerThanRead(state, id, readStartedAt));
  const changed = next.filter((session) => !isNewerThanRead(state, session.id, readStartedAt) && differs(state.sessions.get(session.id), session));
  for (const id of removed) {
    state.sessions.delete(id);
    state.touched.delete(id);
  }
  for (const session of changed) state.sessions.set(session.id, session);
  if (removed.length > 0) return { kind: "removed", sessions: [...state.sessions.values()] };
  return changed.length === 0 ? { kind: "none" } : { kind: "changed", sessions: changed };
}

function upsert(feed: Feed, activity: Activity): void {
  const index = feed.rows.findIndex((row) => row.id === activity.id);
  if (index === -1) feed.rows.push(activity);
  else feed.rows[index] = activity;
  if (feed.rows.length > MAX_CACHED_ROWS) {
    feed.rows.splice(0, feed.rows.length - MAX_CACHED_ROWS);
    feed.hasMore = true;
  }
}

// The peer's own feed lists a broker request (`req-...` id) only while it is pending: once answered, the
// transcript row of the same tool call (its own `toolu_` id) is the one record. The stream still carries the
// resolved request, so the cache must drop it, or an answered question shows twice (F5, 2026-11-16).
function isResolvedRequest(activity: Activity): boolean {
  const isRequest = activity.kind === "permission" || activity.kind === "question";
  return isRequest && activity.id.startsWith(BROKER_ID_PREFIX) && activity.state !== "pending";
}

function applyActivity(feed: Feed, activity: Activity): void {
  if (!isResolvedRequest(activity)) {
    upsert(feed, activity);
    return;
  }
  const index = feed.rows.findIndex((row) => row.id === activity.id);
  if (index !== -1) feed.rows.splice(index, 1);
}

function applyEvent(state: State, event: StreamEvent): void {
  if (event.type === "hello") {
    state.machine = event.machine;
    state.sessions.clear();
    state.touched.clear();
    state.feeds.clear();
    for (const session of event.sessions) {
      state.sessions.set(session.id, session);
      state.touched.set(session.id, Date.now());
    }
  } else if (event.type === "session") {
    state.sessions.set(event.session.id, event.session);
    state.touched.set(event.session.id, Date.now());
  } else if (event.type === "activity") {
    const feed = state.feeds.get(event.sessionId);
    if (feed !== undefined) applyActivity(feed, event.activity);
  }
}

function pageOf(feed: Feed, limit: number): ActivityPage {
  const start = Math.max(0, feed.rows.length - limit);
  const items = feed.rows.slice(start);
  const older = start > 0 || feed.hasMore;
  return { items, nextBefore: older ? (items[0]?.id ?? null) : null };
}

export function createPeerCache(): PeerCache {
  const state: State = { machine: null, sessions: new Map(), feeds: new Map(), touched: new Map() };
  return {
    machine: () => state.machine,
    setMachine(next): void {
      state.machine = next;
    },
    sessions: () => [...state.sessions.values()],
    apply(event): void {
      applyEvent(state, event);
    },
    page(sessionId, limit): ActivityPage | null {
      const feed = state.feeds.get(sessionId);
      if (feed === undefined) return null;
      const holdsLess = feed.rows.length < Math.min(limit, MAX_CACHED_ROWS);
      return holdsLess && feed.hasMore ? null : pageOf(feed, limit);
    },
    seed(sessionId, page): void {
      state.feeds.set(sessionId, { rows: [...page.items], hasMore: page.nextBefore !== null });
    },
    reconcileSessions: (sessions, readStartedAt) => reconcile(state, sessions, readStartedAt),
  };
}
