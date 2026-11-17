import { describe, expect, it } from "vitest";
import { macosMachine, sessionSummaryFixtures } from "../contract/fixturesSessions.js";
import { activityFixtures } from "../contract/fixturesActivity.js";
import { activitySchema, machineSchema, sessionSummarySchema } from "../contract/schema.js";
import { createPeerCache } from "./cache.js";

const machine = machineSchema.parse(macosMachine);
const working = sessionSummarySchema.parse(sessionSummaryFixtures.working);
const other = sessionSummarySchema.parse({ ...sessionSummaryFixtures.working, id: "sess_gone", title: "Deleted test folder" });

describe("PeerCache answered requests", () => {
  const pending = activitySchema.parse({ ...activityFixtures.questionPending, id: "req-t1", requestId: "t1" });
  const answered = activitySchema.parse({ ...activityFixtures.questionAnswered, id: "req-t1", requestId: "t1" });
  const transcriptRow = activitySchema.parse({ ...activityFixtures.questionAnswered, id: "toolu_t1", requestId: "toolu_t1" });

  it("keeps a pending request, and drops it once answered so the transcript row of the tool call stands alone", () => {
    const cache = createPeerCache();
    cache.apply({ type: "hello", machine, sessions: [working] });
    cache.seed(working.id, { items: [], nextBefore: null });
    cache.apply({ type: "activity", sessionId: working.id, activity: pending });
    expect(cache.page(working.id, 10)?.items.map((row) => row.id)).toEqual(["req-t1"]);
    cache.apply({ type: "activity", sessionId: working.id, activity: transcriptRow });
    cache.apply({ type: "activity", sessionId: working.id, activity: answered });
    expect(cache.page(working.id, 10)?.items.map((row) => row.id)).toEqual(["toolu_t1"]);
  });

  it("ignores a resolved request it never held", () => {
    const cache = createPeerCache();
    cache.apply({ type: "hello", machine, sessions: [working] });
    cache.seed(working.id, { items: [], nextBefore: null });
    cache.apply({ type: "activity", sessionId: working.id, activity: answered });
    expect(cache.page(working.id, 10)?.items).toEqual([]);
  });
});

describe("PeerCache.reconcileSessions", () => {
  const later = (): number => Date.now() + 1000;
  const ended = { ...working, status: "ended" as const, canStop: false, replyMode: "resume" as const };

  it("asks for a hello with the whole list only when a session left it, keeps feeds, and says nothing when nothing changed", () => {
    const cache = createPeerCache();
    cache.apply({ type: "hello", machine, sessions: [working, other] });
    cache.seed(working.id, { items: [], nextBefore: null });
    expect(cache.reconcileSessions([working], later())).toEqual({ kind: "removed", sessions: [working] });
    expect(cache.sessions().map((session) => session.id)).toEqual([working.id]);
    expect(cache.page(working.id, 10)).not.toBeNull();
    expect(cache.reconcileSessions([working], later())).toEqual({ kind: "none" });
  });

  it("reports only the sessions that are new or differ, never a hello, when none left", () => {
    const cache = createPeerCache();
    cache.apply({ type: "hello", machine, sessions: [working] });
    expect(cache.reconcileSessions([ended, other], later())).toEqual({ kind: "changed", sessions: [ended, other] });
    expect(cache.sessions().map((session) => session.status)).toEqual(["ended", "working"]);
  });

  it("keeps what the stream said after the read started: neither overwritten by the older snapshot nor dropped", () => {
    const cache = createPeerCache();
    const readStartedAt = Date.now() - 10_000;
    cache.apply({ type: "hello", machine, sessions: [] });
    cache.apply({ type: "session", session: ended });
    cache.apply({ type: "session", session: other });
    expect(cache.reconcileSessions([working], readStartedAt)).toEqual({ kind: "none" });
    expect(cache.sessions().map((session) => session.id).toSorted()).toEqual([other.id, working.id].toSorted());
    expect(cache.sessions().find((session) => session.id === working.id)?.status).toBe("ended");
  });
});

describe("PeerCache.page", () => {
  it("answers a page the cache can fill, and null when it holds fewer rows than asked while the peer has more", () => {
    const cache = createPeerCache();
    const rows = ["a", "b", "c", "d"].map((id) => activitySchema.parse({ ...activityFixtures.questionAnswered, id: `toolu_${id}`, requestId: `toolu_${id}` }));
    cache.seed("s", { items: rows.slice(-2), nextBefore: "toolu_c" });
    expect(cache.page("s", 2)?.items).toHaveLength(2);
    expect(cache.page("s", 1)?.items).toHaveLength(1);
    expect(cache.page("s", 4)).toBeNull();
    cache.seed("s", { items: rows, nextBefore: null });
    expect(cache.page("s", 10)?.items).toHaveLength(4);
  });
});
