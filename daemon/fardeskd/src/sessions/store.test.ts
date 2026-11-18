import { NO_LABEL } from "../service/labelStore.js";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { fixturePath, makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import type { SessionSummary, StreamEvent } from "../contract/schema.js";
import { createBus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import { createLogger } from "../core/log.js";
import type { PendingKind } from "./status.js";
import { createSessionStore } from "./store.js";
import type { SessionStore, StoreDeps } from "./store.js";

const homes: ClaudeHome[] = [];
const stores: SessionStore[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) home.dispose();
});

function newHome(): ClaudeHome {
  const home = createClaudeHome();
  homes.push(home);
  return home;
}

type Overlay = { owned: Set<string>; busy: Set<string>; pending: Map<string, PendingKind>; muted: Set<string>; left: string[] };

type Harness = {
  store: SessionStore;
  events: StreamEvent[];
  logs: string[];
  overlay: Overlay;
  bus: ReturnType<typeof createBus>;
};

function setup(claudeHomes: ClaudeHome[], overrides: Partial<StoreDeps> = {}): Harness {
  const bus = createBus();
  const events: StreamEvent[] = [];
  bus.subscribe((event) => events.push(event));
  const logs: string[] = [];
  const overlay: Overlay = { owned: new Set(), busy: new Set(), pending: new Map(), muted: new Set(), left: [] };
  const store = createSessionStore({
    claudeHomes: claudeHomes.map((home) => home.dir),
    bus,
    log: createLogger((line) => logs.push(line), () => new Date()),
    registryPollMs: 50,
    transcriptPollMs: 20,
    summaryMaxChars: 80,
    limits: { maxEnded: 100, maxEndedReadsPerRefresh: 100, maxFolders: 10 },
    isOwned: (id) => overlay.owned.has(id),
    isBusy: (id) => overlay.busy.has(id),
    pendingKind: (id) => overlay.pending.get(id) ?? null,
    isMuted: (id) => overlay.muted.has(id),
    labelOf: () => NO_LABEL,
    onLeftWaiting: (id) => overlay.left.push(id),
    ...overrides,
  });
  stores.push(store);
  return { store, events, logs, overlay, bus };
}

const ids = (sessions: SessionSummary[]): string[] => sessions.map((session) => session.id);
const sessionEvents = (events: StreamEvent[]): SessionSummary[] =>
  events.flatMap((event) => (event.type === "session" ? [event.session] : []));

function line(object: Record<string, unknown>, second: number): string {
  const timestamp = new Date(Date.parse("2026-11-15T12:00:00.000Z") + second * 1000).toISOString();
  return JSON.stringify({ uuid: `raw-${second}`, timestamp, isSidechain: false, cwd: "/work/project", ...object });
}

const askToolUse = (second: number, id: string): string =>
  line({ type: "assistant", message: { role: "assistant", id: `m${second}`, model: "claude-test", content: [{ type: "tool_use", id, name: "Bash", input: { command: "npm test" } }] } }, second);
const toolOk = (second: number, id: string): string =>
  line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "ok", is_error: false }] } }, second);

describe("sources", () => {
  it("lists nothing for an empty home", () => {
    const home = newHome();
    expect(setup([home]).store.list()).toEqual([]);
  });

  it("merges a live process and its transcript into one session", () => {
    const home = newHome();
    const { sessionId, path } = home.addTranscript({ fixture: "01-simple-session" });
    const { pid } = home.addRegistry({ fixture: "busy", sessionId });
    const { store } = setup([home]);
    const list = store.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: sessionId, status: "working", pid, cwd: "/Users/dev/beta", owned: false });
    const record = store.get(sessionId);
    expect(record.transcriptPath).toBe(path);
    expect(record.process?.pid).toBe(pid);
    expect(record.permissionMode).toBe(store.find(sessionId)?.permissionMode);
    expect(store.activities(sessionId).length).toBeGreaterThan(0);
    expect(store.lines(sessionId).length).toBeGreaterThan(0);
  });

  it("lists a transcript without a live process as ended and computes activities on demand", () => {
    const home = newHome();
    const { sessionId } = home.addTranscript({ fixture: "01-simple-session" });
    const { store } = setup([home]);
    expect(store.list()[0]).toMatchObject({ id: sessionId, status: "ended", replyMode: "resume", pid: null });
    expect(store.activities(sessionId).some((activity) => activity.kind === "tool")).toBe(true);
    expect(store.lines(sessionId).length).toBeGreaterThan(10);
  });

  it("shows a live process that has no transcript yet, with empty activities and lines", () => {
    const home = newHome();
    const sessionId = "99999999-9999-4999-8999-999999999999";
    home.addRegistry({ fixture: "idle", sessionId });
    const { store } = setup([home]);
    expect(store.get(sessionId).summary).toMatchObject({ status: "idle", title: "alpha-task", summary: "" });
    expect(store.activities(sessionId)).toEqual([]);
    expect(store.lines(sessionId)).toEqual([]);
    expect(store.get(sessionId).permissionMode).toBeNull();
  });

  it("never turns a subagent (sidechain) transcript into a session", () => {
    const home = newHome();
    home.addTranscript({ fixture: "08-subagent-sidechain-denied" });
    mkdirSync(join(home.dir, "projects", "-work-project", "x", "subagents"), { recursive: true });
    const { store } = setup([home]);
    expect(store.list()).toEqual([]);
    expect(store.find("08-subagent-sidechain-denied")).toBeUndefined();
  });

  it("does not know a session before its transcript has been read", () => {
    const home = newHome();
    const first = home.addTranscript({ fixture: "01b-minimal-session" });
    const second = home.addTranscript({ fixture: "01b-minimal-session" });
    home.setMtime(second.path, new Date(Date.now() - 5000));
    const { store } = setup([home], { limits: { maxEnded: 100, maxEndedReadsPerRefresh: 1, maxFolders: 10 } });
    expect(store.find(first.sessionId)).toBeDefined();
    expect(() => store.get(second.sessionId)).toThrow(FardeskError);
  });

  it("counts a transcript that exists in two homes once", () => {
    const first = newHome();
    const second = newHome();
    const sessionId = "09090909-0909-4909-8909-090909090909";
    first.addTranscript({ fixture: "01b-minimal-session", sessionId });
    second.addTranscript({ fixture: "01b-minimal-session", sessionId });
    expect(setup([first, second]).store.list()).toHaveLength(1);
  });

  it("ignores dead registry entries", () => {
    const home = newHome();
    home.addRegistry({ fixture: "busy", sessionId: "99999999-9999-4999-8999-999999999999", pid: home.deadPid() });
    expect(setup([home]).store.list()).toEqual([]);
  });

  it("reads registries and transcripts of several homes; the newest registry entry of a session wins", () => {
    const first = newHome();
    const second = newHome();
    const sessionId = "88888888-8888-4888-8888-888888888888";
    first.addRegistry({ fixture: "idle", sessionId, overrides: { updatedAt: 1000 } });
    second.addRegistry({ fixture: "busy", sessionId, overrides: { updatedAt: 2000 } });
    const { store } = setup([first, second]);
    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]?.status).toBe("working");
    const swapped = setup([second, first]);
    expect(swapped.store.list()[0]?.status).toBe("working");
  });
});

describe("order, folders and limits", () => {
  it("orders waiting, working, idle, ended and puts the newest first inside a group", () => {
    const home = newHome();
    const make = (fixture: string | null, overrides: Record<string, unknown>, secondsFromNow: number): string => {
      const { sessionId, path } = home.addTranscript({ fixture: "01b-minimal-session" });
      if (fixture !== null) home.addRegistry({ fixture, sessionId, overrides });
      home.setMtime(path, new Date(Date.now() + secondsFromNow * 1000));
      return sessionId;
    };
    const endedOld = make(null, {}, 10);
    const endedNew = make(null, {}, 20);
    const idleOld = make("idle", { updatedAt: 1 }, 30);
    const idleNew = make("idle", { updatedAt: 1 }, 40);
    const working = make("busy", { updatedAt: 1 }, 50);
    const waiting = make("busy", { status: "waiting", updatedAt: 1 }, 5);
    const { store } = setup([home]);
    expect(ids(store.list())).toEqual([waiting, working, idleNew, idleOld, endedNew, endedOld]);
  });

  it("lists distinct recent folders newest first, capped", () => {
    const home = newHome();
    const make = (cwd: string, secondsFromNow: number): void => {
      const { path } = home.addTranscript({ fixture: "01b-minimal-session" });
      writeFileSync(path, readFileSync(path, "utf8").replaceAll(/"cwd":"[^"]*"/g, `"cwd":"${cwd}"`));
      home.setMtime(path, new Date(Date.now() + secondsFromNow * 1000));
    };
    make("/a", 10);
    make("/b", 30);
    make("/a", 20);
    make("/c", 5);
    const { store } = setup([home], { limits: { maxEnded: 100, maxEndedReadsPerRefresh: 100, maxFolders: 2 } });
    expect(store.recentFolders().folders.map((folder) => folder.path)).toEqual(["/b", "/a"]);
    expect(store.recentFolders().folders[0]?.lastUsedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it("keeps only the newest maxEnded ended sessions but every live one", () => {
    const home = newHome();
    const old = home.addTranscript({ fixture: "01b-minimal-session" });
    const mid = home.addTranscript({ fixture: "01b-minimal-session" });
    const fresh = home.addTranscript({ fixture: "01b-minimal-session" });
    const live = home.addTranscript({ fixture: "01b-minimal-session" });
    home.setMtime(old.path, new Date(Date.now() - 4000));
    home.setMtime(live.path, new Date(Date.now() - 5000));
    home.setMtime(mid.path, new Date(Date.now() - 3000));
    home.setMtime(fresh.path, new Date(Date.now() - 2000));
    home.addRegistry({ fixture: "idle", sessionId: live.sessionId });
    const { store } = setup([home], { limits: { maxEnded: 2, maxEndedReadsPerRefresh: 100, maxFolders: 10 } });
    expect(new Set(ids(store.list()))).toEqual(new Set([live.sessionId, fresh.sessionId, mid.sessionId]));
  });

  it("reads at most maxEndedReadsPerRefresh new ended transcripts per cycle, then catches up", () => {
    const home = newHome();
    for (let index = 0; index < 3; index += 1) home.addTranscript({ fixture: "01b-minimal-session" });
    const { store } = setup([home], { limits: { maxEnded: 100, maxEndedReadsPerRefresh: 1, maxFolders: 10 } });
    expect(store.list()).toHaveLength(1);
    store.refresh();
    expect(store.list()).toHaveLength(2);
    store.refresh();
    expect(store.list()).toHaveLength(3);
    store.refresh();
    expect(store.list()).toHaveLength(3);
  });

  it("summarises a transcript over the full-read limit from its head and tail", () => {
    const home = newHome();
    const { sessionId, path } = home.addTranscript({ fixture: "01-simple-session" });
    const text = readFileSync(fixturePath("transcripts", "01-simple-session.jsonl"), "utf8");
    writeFileSync(path, text.repeat(5));
    const { store } = setup([home]);
    expect(store.list()[0]).toMatchObject({ id: sessionId, status: "ended" });
    expect(store.list()[0]?.title.length).toBeGreaterThan(0);
  });

  it("rereads an ended transcript only when its mtime or size changed", () => {
    const home = newHome();
    const { sessionId, path } = home.addTranscript({ fixture: "01b-minimal-session" });
    const { store, events } = setup([home]);
    const before = sessionEvents(events).length;
    store.refresh();
    expect(sessionEvents(events)).toHaveLength(before);
    const appended = line({ type: "assistant", message: { role: "assistant", id: "z", model: "claude-test", content: [{ type: "text", text: "A brand new reply." }] } }, 500);
    appendFileSync(path, `${appended}\n`);
    store.refresh();
    expect(store.get(sessionId).summary.summary).toBe("A brand new reply.");
    expect(sessionEvents(events).length).toBe(before + 1);
  });
});

describe("live updates", () => {
  it("publishes a session event for a new session, and nothing when nothing changed", () => {
    const home = newHome();
    const { store, events } = setup([home]);
    home.addRegistry({ fixture: "idle", sessionId: "77777777-7777-4777-8777-777777777777" });
    store.refresh();
    expect(sessionEvents(events)).toHaveLength(1);
    store.refresh();
    expect(sessionEvents(events)).toHaveLength(1);
  });

  it("publishes changed sessions and new or changed activities when the tailer delivers lines", async () => {
    const home = newHome();
    const { sessionId, path } = home.addTranscript({ fixture: "01b-minimal-session" });
    home.addRegistry({ fixture: "busy", sessionId });
    const { store, events } = setup([home]);
    const activityEvents = (): string[] =>
      events.flatMap((event) => (event.type === "activity" ? [`${event.activity.kind}:${"status" in event.activity ? event.activity.status : ""}`] : []));
    expect(activityEvents()).toEqual([]);
    appendFileSync(path, `${askToolUse(900, "toolu_live1")}\n`);
    await waitUntil(() => activityEvents().includes("tool:running"));
    appendFileSync(path, `${toolOk(901, "toolu_live1")}\n`);
    await waitUntil(() => activityEvents().includes("tool:ok"));
    expect(store.get(sessionId).summary.status).toBe("working");
    expect(sessionEvents(events).at(-1)?.id).toBe(sessionId);
    expect(store.activities(sessionId).at(-1)).toMatchObject({ kind: "tool", status: "ok" });
  });

  it("starts the tailer when the transcript of a live session shows up later", async () => {
    const home = newHome();
    const sessionId = "66666666-6666-4666-8666-666666666666";
    home.addRegistry({ fixture: "busy", sessionId });
    const { store } = setup([home]);
    expect(store.get(sessionId).transcriptPath).toBeNull();
    home.addTranscript({ fixture: "01b-minimal-session", sessionId });
    await waitUntil(() => store.get(sessionId).transcriptPath !== null);
    await waitUntil(() => store.activities(sessionId).length > 0);
  });

  it("sees a new registry file within the polling interval", async () => {
    const home = newHome();
    const { store } = setup([home], { registryPollMs: 100 });
    const started = Date.now();
    home.addRegistry({ fixture: "idle", sessionId: "55555555-5555-4555-8555-555555555555" });
    await waitUntil(() => store.list().length === 1, 3000);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it("sees a new registry file within 3 seconds with the default 1000 ms poll", async () => {
    const home = newHome();
    const { store } = setup([home], { registryPollMs: 1000 });
    const started = Date.now();
    home.addRegistry({ fixture: "idle", sessionId: "44444444-4444-4444-8444-444444444444" });
    await waitUntil(() => store.list().length === 1, 3000);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("turns a session into ended when its process dies and drops it when nothing is left", async () => {
    const home = newHome();
    const { sessionId } = home.addTranscript({ fixture: "01b-minimal-session" });
    const { pid } = home.addRegistry({ fixture: "busy", sessionId });
    const lonely = home.addRegistry({ fixture: "idle", sessionId: "33333333-3333-4333-8333-333333333333" });
    const { store, events } = setup([home]);
    expect(store.list()).toHaveLength(2);
    await home.killLive(pid);
    await home.killLive(lonely.pid);
    await waitUntil(() => store.find(sessionId)?.summary.status === "ended");
    await waitUntil(() => store.list().length === 1);
    expect(store.get(sessionId).process).toBeNull();
    expect(sessionEvents(events).some((session) => session.id === sessionId && session.status === "ended")).toBe(true);
  });

  it("removes a session whose registry file is deleted and whose transcript is gone", () => {
    const home = newHome();
    const { pid } = home.addRegistry({ fixture: "idle", sessionId: "22222222-2222-4222-8222-222222222222" });
    const { store } = setup([home]);
    expect(store.list()).toHaveLength(1);
    home.removeRegistry(pid);
    store.refresh();
    expect(store.list()).toEqual([]);
  });
});

describe("leaving the waiting state", () => {
  it("calls onLeftWaiting once when the registry status leaves waiting", async () => {
    const home = newHome();
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const { pid } = home.addRegistry({ fixture: "busy", sessionId, overrides: { status: "waiting" } });
    const { store, overlay } = setup([home]);
    expect(store.get(sessionId).summary.status).toBe("waiting");
    expect(overlay.left).toEqual([]);
    home.addRegistry({ fixture: "busy", sessionId, pid, overrides: { status: "busy" } });
    await waitUntil(() => overlay.left.length > 0);
    await sleep(200);
    expect(overlay.left).toEqual([sessionId]);
  });

  it("calls onLeftWaiting when a waiting process vanishes", () => {
    const home = newHome();
    const sessionId = "10101010-1010-4010-8010-101010101010";
    const { pid } = home.addRegistry({ fixture: "busy", sessionId, overrides: { status: "waiting" } });
    const { store, overlay } = setup([home]);
    home.removeRegistry(pid);
    store.refresh();
    expect(overlay.left).toEqual([sessionId]);
  });
});

describe("overlays", () => {
  it("reflects owned, busy, pending and muted state on recompute", () => {
    const home = newHome();
    const sessionId = "12121212-1212-4121-8121-121212121212";
    home.addRegistry({ fixture: "idle", sessionId });
    const { store, overlay, events } = setup([home]);
    expect(store.get(sessionId).summary).toMatchObject({ owned: false, muted: false, status: "idle" });
    overlay.owned.add(sessionId);
    overlay.busy.add(sessionId);
    overlay.muted.add(sessionId);
    store.recompute(sessionId);
    expect(store.get(sessionId).summary).toMatchObject({ owned: true, muted: true, status: "working", replyMode: "composer" });
    store.recompute("unknown-id");
    expect(sessionEvents(events).at(-1)?.owned).toBe(true);
  });

  it("recomputes a session when the broker publishes a pending permission or question for it", () => {
    const home = newHome();
    const sessionId = "13131313-1313-4131-8131-131313131313";
    home.addRegistry({ fixture: "idle", sessionId });
    const { store, overlay, bus } = setup([home]);
    overlay.pending.set(sessionId, "permission");
    const activity = { id: "req-1", ts: "2026-11-15T10:00:00.000Z", kind: "permission" as const, requestId: "1", tool: "Bash", title: "t", summary: "", cwd: "/x", destructive: false, state: "pending" as const };
    bus.publish({ type: "activity", sessionId, activity });
    expect(store.get(sessionId).summary).toMatchObject({ status: "waiting", waitingFor: "permission" });
    overlay.pending.set(sessionId, "question");
    bus.publish({ type: "activity", sessionId, activity: { ...activity, id: "q", kind: "question", text: "?", options: [], state: "pending" } as never });
    expect(store.get(sessionId).summary.waitingFor).toBe("question");
    overlay.pending.delete(sessionId);
    bus.publish({ type: "activity", sessionId, activity: { id: "u", ts: activity.ts, kind: "user", text: "hi" } });
    expect(store.get(sessionId).summary.status).toBe("waiting");
    bus.publish({ type: "activity", sessionId: "someone-else", activity });
    bus.publish({ type: "ping", ts: activity.ts });
  });
});

describe("errors and lifecycle", () => {
  it("throws not_found for an unknown session and returns undefined from find", () => {
    const { store } = setup([newHome()]);
    for (const call of [(): unknown => store.get("nope"), (): unknown => store.activities("nope"), (): unknown => store.lines("nope")]) {
      expect(call).toThrow(FardeskError);
    }
    expect(store.find("nope")).toBeUndefined();
  });

  it("logs a failing poll cycle instead of crashing the interval", async () => {
    const home = newHome();
    const { logs } = setup([home], { registryPollMs: 30 });
    rmSync(join(home.dir, "sessions"), { recursive: true });
    writeFileSync(join(home.dir, "sessions"), "not a directory");
    await waitUntil(() => logs.some((entry) => entry.includes("session_refresh_failed")));
  });

  it("fails fast when the first poll cannot run", () => {
    const broken = makeTempDir();
    writeFileSync(join(broken, "sessions"), "not a directory");
    expect(() => setup([{ dir: broken } as ClaudeHome])).toThrow();
  });

  it("stops polling after close", async () => {
    const home = newHome();
    const { store } = setup([home], { registryPollMs: 30 });
    store.close();
    home.addRegistry({ fixture: "idle", sessionId: "14141414-1414-4141-8141-141414141414" });
    await sleep(150);
    expect(store.list()).toEqual([]);
  });
});
