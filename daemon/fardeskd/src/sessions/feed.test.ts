import { basename } from "node:path";
import { NO_LABEL } from "../service/labelStore.js";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { createBus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import { createLogger } from "../core/log.js";
import { createBroker } from "../permissions/broker.js";
import { pagedFeed, sessionDetail, sessionFeed } from "./feed.js";
import { createSessionStore } from "./store.js";
import type { SessionStore } from "./store.js";

const homes: ClaudeHome[] = [];
const stores: SessionStore[] = [];
const BIG = 1000;

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) home.dispose();
});

function setup(fixture: string): { store: SessionStore; broker: ReturnType<typeof createBroker>; sessionId: string } {
  const home = createClaudeHome();
  homes.push(home);
  const { sessionId } = home.addTranscript({ fixture });
  const bus = createBus();
  let counter = 0;
  const broker = createBroker({ timeoutMs: 60_000, bus, now: () => new Date(), newId: () => `r${String(++counter)}`, allowBypass: true });
  const store = createSessionStore({
    claudeHomes: [{ path: home.dir, name: basename(home.dir) }],
    bus,
    log: createLogger(() => undefined, () => new Date()),
    registryPollMs: 1000,
    transcriptPollMs: 1000,
    summaryMaxChars: 80,
    limits: { maxEnded: 10, maxEndedReadsPerRefresh: 10, maxFolders: 5 },
    isOwned: () => false,
    isBusy: () => false,
    pendingKind: (id) => broker.pendingKind(id),
    isMuted: () => false,
    labelOf: () => NO_LABEL,
    autoColors: { get: () => null, assign: () => undefined },
    onLeftWaiting: () => undefined,
  });
  stores.push(store);
  return { store, broker, sessionId };
}

describe("sessionFeed", () => {
  it("appends pending broker requests to the transcript activities and drops them once resolved", () => {
    const { store, broker, sessionId } = setup("01b-minimal-session");
    const base = store.activities(sessionId).length;
    const { requestId } = broker.ask({ sessionId, toolName: "Bash", toolInput: { command: "ls" }, cwd: "/work" });
    const feed = sessionFeed(store, broker, sessionId);
    expect(feed).toHaveLength(base + 1);
    expect(feed.at(-1)).toMatchObject({ kind: "permission", requestId, state: "pending" });
    broker.decide(sessionId, requestId, "allow");
    expect(sessionFeed(store, broker, sessionId)).toHaveLength(base);
  });

  it("throws not_found for an unknown session", () => {
    const { store, broker } = setup("01b-minimal-session");
    expect(() => sessionFeed(store, broker, "nope")).toThrow(FardeskError);
  });
});

describe("pagedFeed", () => {
  it("pages the combined feed, newest rows first window, oldest first inside", () => {
    const { store, broker, sessionId } = setup("01-simple-session");
    broker.ask({ sessionId, toolName: "Bash", toolInput: { command: "ls" }, cwd: "/work" });
    const all = sessionFeed(store, broker, sessionId);
    const page = pagedFeed(store, broker, sessionId, { limit: 2 });
    expect(page.items).toEqual(all.slice(-2));
    expect(page.nextBefore).toBe(all.at(-2)?.id);
    expect(pagedFeed(store, broker, sessionId, { limit: BIG }).nextBefore).toBeNull();
  });
});

describe("sessionDetail", () => {
  it("builds the detail of a tool activity from the session lines", () => {
    const { store, sessionId } = setup("05-edit-write-read-test-run");
    const row = store.activities(sessionId).find((activity) => activity.kind === "tool" && activity.hasDetail);
    if (row === undefined) throw new Error("fixture has no tool row with detail");
    const detail = sessionDetail(store, sessionId, row.id, { maxOutputLines: 40, maxDiffLines: 400 });
    expect(detail.activityId).toBe(row.id);
    expect(detail.sections.length).toBeGreaterThan(0);
  });

  it("throws not_found for an unknown activity and for an unknown session", () => {
    const { store, sessionId } = setup("01b-minimal-session");
    const limits = { maxOutputLines: 40, maxDiffLines: 400 };
    expect(() => sessionDetail(store, sessionId, "nope", limits)).toThrow(FardeskError);
    expect(() => sessionDetail(store, "nope", "x", limits)).toThrow(FardeskError);
  });
});
