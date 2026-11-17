import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APNS_TEST_CERT, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import type { PushContent } from "../config/config.js";
import type { Activity, NotificationType, SessionSummary } from "../contract/schema.js";
import { createBus } from "../core/bus.js";
import { createLogger } from "../core/log.js";
import { createApnsClient } from "./apns.js";
import type { ApnsClient } from "./apns.js";
import { createDeviceStore } from "./deviceStore.js";
import type { DeviceStore } from "./deviceStore.js";
import { DONE_BODY_MAX_CHARS, createNotifier } from "./notifier.js";
import type { Notifier } from "./notifier.js";

const TOKEN_A = "aa".repeat(32);
const TOKEN_B = "bb".repeat(32);
const ALL: NotificationType[] = ["done", "permission", "question", "ended"];
const NOW = "2026-11-15T10:00:00.000Z";

const servers: ApnsTestServer[] = [];
const clients: ApnsClient[] = [];
const notifiers: Notifier[] = [];

afterEach(async () => {
  for (const notifier of notifiers.splice(0)) notifier.close();
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

type Setup = {
  bus: ReturnType<typeof createBus>;
  sandbox: ApnsTestServer;
  production: ApnsTestServer;
  devices: DeviceStore;
  notifier: Notifier;
  logs: string[];
  muted: Set<string>;
  state: { paused: boolean; working: Set<string>; unknown: Set<string> };
};

type Options = { enabled?: NotificationType[]; withApns?: boolean; doneDelayMs?: number; content?: PushContent };

async function setup(options: Options = {}): Promise<Setup> {
  const sandbox = await startApnsServer();
  const production = await startApnsServer();
  servers.push(sandbox, production);
  const client = createApnsClient({
    tokenSource: { token: (): string => "jwt" },
    topic: "com.example.fardesk",
    hosts: { sandbox: sandbox.host, production: production.host },
    ca: APNS_TEST_CERT,
  });
  clients.push(client);
  const bus = createBus();
  const logs: string[] = [];
  const muted = new Set<string>();
  const state = { paused: false, working: new Set<string>(), unknown: new Set<string>() };
  const devices = createDeviceStore(join(makeTempDir(), "devices.json"), () => new Date(NOW));
  const notifier = createNotifier({
    bus,
    apns: options.withApns === false ? null : client,
    devices,
    describe: (id) => ({ title: `Title of ${id}`, summary: id === "s-quiet" ? "" : "Session summary" }),
    isMuted: (id) => muted.has(id),
    notificationsEnabled: options.enabled ?? ALL,
    machineName: "mac-mini",
    content: options.content ?? "full",
    isPaused: () => state.paused,
    isWorking: (id) => state.working.has(id),
    isKnown: (id) => !state.unknown.has(id),
    doneDelayMs: options.doneDelayMs ?? 0,
    log: createLogger((line) => logs.push(line), () => new Date(NOW)),
  });
  notifiers.push(notifier);
  return { bus, sandbox, production, devices, notifier, logs, muted, state };
}

function register(devices: DeviceStore, token: string, notifications: NotificationType[], environment: "sandbox" | "production" = "sandbox"): void {
  devices.upsert({ apnsToken: token, environment, name: "iPhone", notifications });
}

const permission = (state: "pending" | "allowed" = "pending"): Extract<Activity, { kind: "permission" }> => ({
  id: "req-r1",
  ts: NOW,
  kind: "permission",
  requestId: "r1",
  tool: "Bash",
  title: "Run npm test",
  summary: "in /work",
  cwd: "/work",
  destructive: false,
  state,
});

const question: Activity = { id: "req-q1", ts: NOW, kind: "question", requestId: "q1", text: "Tea or coffee?", options: ["Tea", "Coffee"], state: "pending" };

const session = (status: SessionSummary["status"], id = "s1", summary = "All fine"): SessionSummary => ({
  id,
  title: "t",
  cwd: "/work",
  status,
  waitingFor: null,
  owned: false,
  replyMode: "composer",
  canStop: false,
  summary,
  model: null,
  pid: null,
  muted: false,
  permissionMode: null,
  contextTokens: null,
  cacheExpiresAt: null,
  startedAt: NOW,
  updatedAt: NOW,
});

function payload(server: ApnsTestServer, index = 0): { aps: Record<string, unknown> } & Record<string, string> {
  return JSON.parse(server.requests[index]?.body ?? "{}") as { aps: Record<string, unknown> } & Record<string, string>;
}

describe("requests that need an answer", () => {
  it("pushes a pending permission request with category, title, body and data", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => sandbox.requests.length === 1);
    const body = payload(sandbox);
    expect(sandbox.requests[0]?.path).toBe(`/3/device/${TOKEN_A}`);
    expect(body.aps).toMatchObject({
      alert: { title: "Title of s1", body: "Run npm test: in /work" },
      category: "PERMISSION",
      "thread-id": "s1",
      "interruption-level": "time-sensitive",
    });
    expect(body).toMatchObject({ sessionId: "s1", requestId: "r1", machine: "mac-mini" });
  });

  it("uses the title alone when a permission request has no summary", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: { ...permission(), summary: "" } });
    await waitUntil(() => sandbox.requests.length === 1);
    expect((payload(sandbox).aps["alert"] as { body: string }).body).toBe("Run npm test");
  });

  it("pushes a pending question with the question text", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: question });
    await waitUntil(() => sandbox.requests.length === 1);
    expect(payload(sandbox).aps).toMatchObject({ alert: { body: "Tea or coffee?" }, category: "QUESTION" });
    expect(payload(sandbox)["requestId"]).toBe("q1");
  });

  it("does not push for resolved requests, other activities or other events", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: permission("allowed") });
    bus.publish({ type: "activity", sessionId: "s1", activity: { id: "u", ts: NOW, kind: "user", text: "hi" } });
    bus.publish({ type: "ping", ts: NOW });
    await sleep(150);
    expect(sandbox.requests).toHaveLength(0);
  });
});

describe("who gets a push", () => {
  it("sends only to devices that want the type, each to its own environment", async () => {
    const { bus, sandbox, production, devices } = await setup();
    register(devices, TOKEN_A, ["permission"], "sandbox");
    register(devices, TOKEN_B, ["permission", "done"], "production");
    register(devices, "cc".repeat(32), ["done"], "sandbox");
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => sandbox.requests.length === 1 && production.requests.length === 1);
    await sleep(100);
    expect(sandbox.requests).toHaveLength(1);
    expect(production.requests[0]?.path).toBe(`/3/device/${TOKEN_B}`);
  });

  it("sends nothing for muted sessions, disabled types, or without an APNs client", async () => {
    const muted = await setup();
    register(muted.devices, TOKEN_A, ALL);
    muted.muted.add("s1");
    muted.bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    const disabled = await setup({ enabled: ["done"] });
    register(disabled.devices, TOKEN_A, ALL);
    disabled.bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    const none = await setup({ withApns: false });
    register(none.devices, TOKEN_A, ALL);
    none.bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    none.notifier.done({ sessionId: "s1", lastAssistantMessage: "x" });
    await sleep(150);
    expect([muted.sandbox, disabled.sandbox, none.sandbox].map((server) => server.requests.length)).toEqual([0, 0, 0]);
  });

  it("stops pushing after close", async () => {
    const { bus, sandbox, devices, notifier } = await setup();
    register(devices, TOKEN_A, ALL);
    notifier.close();
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await sleep(150);
    expect(sandbox.requests).toHaveLength(0);
  });
});

describe("push content generic", () => {
  it("puts no session title, summary or assistant text into the APNs payload", async () => {
    const { bus, sandbox, devices, notifier } = await setup({ content: "generic" });
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    notifier.done({ sessionId: "s1", lastAssistantMessage: "secret plan: rotate the keys" });
    bus.publish({ type: "session", session: session("working", "s2", "Very private summary") });
    bus.publish({ type: "session", session: session("ended", "s2", "Very private summary") });
    await waitUntil(() => sandbox.requests.length === 3);
    const bodies = [0, 1, 2].map((index) => sandbox.requests[index]?.body ?? "");
    for (const text of bodies) {
      for (const secret of ["Title of", "npm test", "secret plan", "Very private", "/work"]) expect(text).not.toContain(secret);
    }
    const alerts = [0, 1, 2].map((index) => payload(sandbox, index).aps["alert"]);
    expect(alerts).toContainEqual({ title: "Fardesk", body: "A session on mac-mini needs you" });
    expect(alerts).toContainEqual({ title: "Fardesk", body: "A session on mac-mini is done" });
    expect(alerts).toContainEqual({ title: "Fardesk", body: "A session on mac-mini has ended" });
  });
});

describe("done", () => {
  it("pushes the trimmed last assistant message", async () => {
    const { sandbox, devices, notifier } = await setup();
    register(devices, TOKEN_A, ALL);
    notifier.done({ sessionId: "s1", lastAssistantMessage: `  ${"word ".repeat(100)}  ` });
    await waitUntil(() => sandbox.requests.length === 1);
    const alert = payload(sandbox).aps["alert"] as { body: string };
    expect(alert.body.length).toBeLessThanOrEqual(DONE_BODY_MAX_CHARS);
    expect(alert.body.endsWith("...")).toBe(true);
    expect(payload(sandbox).aps["category"]).toBe("DONE");
    expect(payload(sandbox)["requestId"]).toBeUndefined();
  });

  it("falls back to the session summary, then to a fixed text", async () => {
    const { sandbox, devices, notifier } = await setup();
    register(devices, TOKEN_A, ALL);
    notifier.done({ sessionId: "s1", lastAssistantMessage: null });
    notifier.done({ sessionId: "s-quiet", lastAssistantMessage: "   " });
    await waitUntil(() => sandbox.requests.length === 2);
    const bodies = [0, 1].map((index) => (payload(sandbox, index).aps["alert"] as { body: string }).body).sort();
    expect(bodies).toEqual(["Finished", "Session summary"]);
  });
});

describe("ended", () => {
  it("pushes when a known session changes to ended, once, and not for sessions first seen as ended", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "session", session: session("ended", "old") });
    bus.publish({ type: "session", session: session("working") });
    bus.publish({ type: "session", session: session("ended") });
    bus.publish({ type: "session", session: session("ended") });
    await waitUntil(() => sandbox.requests.length === 1);
    await sleep(100);
    expect(sandbox.requests).toHaveLength(1);
    expect(payload(sandbox).aps).toMatchObject({ alert: { body: "All fine" }, category: "ENDED", "thread-id": "s1" });
  });

  it("uses a fixed body when the ended session has no summary", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    bus.publish({ type: "session", session: session("idle", "s2", "") });
    bus.publish({ type: "session", session: session("ended", "s2", "") });
    await waitUntil(() => sandbox.requests.length === 1);
    expect((payload(sandbox).aps["alert"] as { body: string }).body).toBe("Session ended");
  });
});

describe("send errors", () => {
  it("removes a device whose token APNs says is dead", async () => {
    const { bus, sandbox, devices } = await setup();
    register(devices, TOKEN_A, ALL);
    sandbox.script.push({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) });
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => devices.list().length === 0);
  });

  it("logs other errors, keeps the device and never throws", async () => {
    const { bus, sandbox, devices, logs } = await setup();
    register(devices, TOKEN_A, ALL);
    sandbox.script.push({ status: 500, body: JSON.stringify({ reason: "InternalServerError" }) });
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => logs.some((line) => line.includes("push_failed")));
    expect(devices.list()).toHaveLength(1);
  });
});

describe("pause, quiet period and logging", () => {
  it("never pushes for a session this daemon does not know (a test run's own Claude home), and logs why", async () => {
    const { sandbox, devices, notifier, logs, state } = await setup();
    register(devices, TOKEN_A, ALL);
    state.unknown.add("s-foreign");
    notifier.done({ sessionId: "s-foreign", lastAssistantMessage: "from a test run" });
    notifier.done({ sessionId: "s1", lastAssistantMessage: "real work" });
    await waitUntil(() => sandbox.requests.length === 1);
    await sleep(100);
    expect(sandbox.requests).toHaveLength(1);
    expect(logs.some((line) => line.includes("push_skipped") && line.includes("unknown session") && line.includes("s-foreign"))).toBe(true);
  });

  it("sends nothing while paused, logs push_skipped, and pushes again after resume", async () => {
    const { bus, sandbox, devices, logs, state } = await setup();
    register(devices, TOKEN_A, ALL);
    state.paused = true;
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await sleep(150);
    expect(sandbox.requests).toHaveLength(0);
    expect(logs.some((line) => line.includes("push_skipped") && line.includes("paused"))).toBe(true);
    state.paused = false;
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => sandbox.requests.length === 1);
  });

  it("sends only the last Stop of a burst, after the quiet period", async () => {
    const { sandbox, devices, notifier } = await setup({ doneDelayMs: 150 });
    register(devices, TOKEN_A, ALL);
    for (const text of ["one", "two", "three"]) {
      notifier.done({ sessionId: "s1", lastAssistantMessage: text });
      await sleep(40);
    }
    expect(sandbox.requests).toHaveLength(0);
    await waitUntil(() => sandbox.requests.length === 1);
    await sleep(250);
    expect(sandbox.requests).toHaveLength(1);
    expect((payload(sandbox).aps["alert"] as { body: string }).body).toBe("three");
  });

  it("drops a done push when the session is working again", async () => {
    const { sandbox, devices, notifier, logs, state } = await setup({ doneDelayMs: 60 });
    register(devices, TOKEN_A, ALL);
    notifier.done({ sessionId: "s1", lastAssistantMessage: "x" });
    state.working.add("s1");
    await waitUntil(() => logs.some((line) => line.includes("working again")));
    await sleep(100);
    expect(sandbox.requests).toHaveLength(0);
  });

  it("clears pending done timers on close", async () => {
    const { sandbox, devices, notifier } = await setup({ doneDelayMs: 80 });
    register(devices, TOKEN_A, ALL);
    notifier.done({ sessionId: "s1", lastAssistantMessage: "x" });
    notifier.close();
    await sleep(200);
    expect(sandbox.requests).toHaveLength(0);
  });

  it("logs push_sent with the number of devices that accepted it", async () => {
    const { bus, sandbox, devices, logs } = await setup();
    register(devices, TOKEN_A, ALL);
    register(devices, TOKEN_B, ALL);
    bus.publish({ type: "activity", sessionId: "s1", activity: permission() });
    await waitUntil(() => logs.some((line) => line.includes("push_sent")));
    expect(sandbox.requests).toHaveLength(2);
    const line = logs.find((entry) => entry.includes("push_sent")) ?? "";
    expect(line).toContain('"devices":2');
    expect(line).toContain('"sessionId":"s1"');
  });
});
