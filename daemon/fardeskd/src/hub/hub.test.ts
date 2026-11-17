// The hub against real daemons on 127.0.0.1: one live peer, one closed port, the hub itself.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { authOverrides, loginAs } from "../../test/support/auth.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { freePort, waitUntil } from "../../test/support/env.js";
import { activityPageSchema, authDeviceListSchema, errorResponseSchema, hubStateSchema, machineSchema, sessionSummarySchema, streamEventSchema } from "../contract/schema.js";
import type { StreamEvent } from "../contract/schema.js";

let peer: TestDaemon;
let hub: TestDaemon;

async function startHub(extra: Record<string, unknown> = {}): Promise<TestDaemon> {
  const dead = await freePort();
  return startTestDaemon({
    name: "hub-box",
    hub: { enabled: true, probeMs: 200 },
    peers: [{ name: "Peer A", url: peer.url }, { name: "dead", url: `http://127.0.0.1:${dead}` }, { name: "unlinked", url: peer.url }],
    coordinator: { peerTokens: { "Peer A": TEST_TOKEN, dead: TEST_TOKEN } },
    ...extra,
  });
}

const state = async (): Promise<ReturnType<typeof hubStateSchema.parse>> => hubStateSchema.parse((await hub.call("GET", "/v1/hub")).json);
const entry = async (name: string): Promise<ReturnType<typeof hubStateSchema.parse>["machines"][number] | undefined> =>
  (await state()).machines.find((machine) => machine.name === name);

async function eventually(check: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("condition never became true");
}

async function untilPeerLive(): Promise<void> {
  await eventually(async () => (await entry("Peer A"))?.online === true);
  await eventually(async () => (await hub.call("GET", "/m/Peer%20A/v1/machine")).status === 200);
}

async function addSession(): Promise<string> {
  const { sessionId } = peer.home.addTranscript({ fixture: "01-simple-session" });
  peer.home.addRegistry({ fixture: "idle", sessionId });
  await waitUntil(() => peer.services.sessions().some((session) => session.id === sessionId));
  return sessionId;
}

beforeEach(async () => {
  peer = await startTestDaemon({ name: "Peer A" });
  hub = await startHub();
});

afterEach(async () => {
  await hub.close();
  await peer.close();
});

describe("GET /v1/hub", () => {
  it("lists the hub first, a live peer online, a closed port and a tokenless peer offline with plain problems", async () => {
    await untilPeerLive();
    const hubState = await state();
    expect(hubState.hub).toBe("hub-box");
    expect(hubState.machines.map((machine) => machine.name)).toEqual(["hub-box", "Peer A", "dead", "unlinked"]);
    expect(hubState.machines[0]).toMatchObject({ hub: true, online: true, problem: null });
    expect(hubState.machines[1]).toMatchObject({ online: true, problem: null });
    expect(hubState.machines[1]?.latencyMs).not.toBeNull();
    const dead = await waitForProblem("dead");
    expect(dead).toMatchObject({ online: false, latencyMs: null });
    expect(dead.problem).toContain("connection refused");
    expect((await entry("unlinked"))?.problem).toBe("not linked: no token for it in coordinator.peerTokens");
  });

  it("counts sessions of a peer from its stream", async () => {
    await untilPeerLive();
    await addSession();
    await eventually(async () => (await entry("Peer A"))?.sessions === 1);
    expect((await entry("Peer A"))?.sessions).toBe(1);
  });
});

async function waitForProblem(name: string): Promise<NonNullable<Awaited<ReturnType<typeof entry>>>> {
  await eventually(async () => {
    const problem = (await entry(name))?.problem;
    return problem !== null && problem !== undefined && problem !== "not checked yet";
  });
  const found = await entry(name);
  if (found === undefined) throw new Error(`no machine ${name}`);
  return found;
}

describe("/m/<machine>", () => {
  it("serves the hub's own machine through /m/<self>/ and the peer's machine from cache", async () => {
    await untilPeerLive();
    const own = await hub.call("GET", "/m/hub-box/v1/machine");
    expect(machineSchema.parse(own.json).name).toBe("hub-box");
    const viaHub = await hub.call("GET", "/m/Peer%20A/v1/machine");
    expect(viaHub.status).toBe(200);
    expect(machineSchema.parse(viaHub.json).name).toBe("Peer A");
  });

  it("answers sessions and the newest activity page of a peer from its cache", async () => {
    await untilPeerLive();
    const id = await addSession();
    await eventually(async () => (await entry("Peer A"))?.sessions === 1);
    const sessions = sessionSummarySchema.array().parse((await hub.call("GET", "/m/Peer%20A/v1/sessions")).json);
    expect(sessions.map((session) => session.id)).toEqual([id]);
    const direct = activityPageSchema.parse((await peer.call("GET", `/v1/sessions/${id}/activity`)).json);
    const first = activityPageSchema.parse((await hub.call("GET", `/m/Peer%20A/v1/sessions/${id}/activity`)).json);
    const second = activityPageSchema.parse((await hub.call("GET", `/m/Peer%20A/v1/sessions/${id}/activity?limit=2`)).json);
    expect(first).toEqual(direct);
    expect(second.items).toEqual(direct.items.slice(-2));
    const older = await hub.call("GET", `/m/Peer%20A/v1/sessions/${id}/activity?limit=2&before=${second.nextBefore}`);
    expect(activityPageSchema.parse(older.json).items).toEqual(direct.items.slice(-4, -2));
  });

  it("serves a longer page than the one that filled its cache, with the same rows the peer has", async () => {
    await untilPeerLive();
    const id = await addSession();
    await eventually(async () => (await entry("Peer A"))?.sessions === 1);
    const direct = activityPageSchema.parse((await peer.call("GET", `/v1/sessions/${id}/activity`)).json);
    const short = activityPageSchema.parse((await hub.call("GET", `/m/Peer%20A/v1/sessions/${id}/activity?limit=2`)).json);
    expect(short.items).toEqual(direct.items.slice(-2));
    expect(short.nextBefore).not.toBeNull();
    const longer = activityPageSchema.parse((await hub.call("GET", `/m/Peer%20A/v1/sessions/${id}/activity?limit=4`)).json);
    expect(longer.items).toEqual(direct.items.slice(-4));
  });

  it("forwards a POST to the peer with the peer token and passes its status through", async () => {
    await untilPeerLive();
    const id = await addSession();
    const muted = await hub.call("POST", `/m/Peer%20A/v1/sessions/${id}/mute`, { muted: true });
    expect(muted).toEqual({ status: 200, json: { ok: true } });
    expect(peer.services.sessions().find((session) => session.id === id)?.muted).toBe(true);
    const missing = await hub.call("POST", "/m/Peer%20A/v1/sessions/nope/mute", { muted: true });
    expect(missing.status).toBe(404);
    expect(errorResponseSchema.parse(missing.json).error.code).toBe("not_found");
  });

  it("passes the binary bytes and media type of a peer's attachment through", async () => {
    await untilPeerLive();
    const id = await addSession();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x80]);
    const headers = { authorization: `Bearer ${TEST_TOKEN}` };
    const stored = await fetch(`${peer.url}/v1/sessions/${id}/attachments`, { method: "POST", headers: { ...headers, "content-type": "image/png" }, body: bytes });
    const { path } = (await stored.json()) as { path: string };
    const viaHub = await fetch(`${hub.url}/m/Peer%20A/v1/sessions/${id}/attachment?path=${encodeURIComponent(path)}`, { headers });
    expect(viaHub.status).toBe(200);
    expect(viaHub.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await viaHub.arrayBuffer())).toEqual(bytes);
  });

  it("answers 503 machine_offline at once for an offline peer and 404 for an unknown machine", async () => {
    await waitForProblem("dead");
    const started = Date.now();
    const offline = await hub.call("GET", "/m/dead/v1/sessions");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(offline.status).toBe(503);
    const error = errorResponseSchema.parse(offline.json).error;
    expect(error.code).toBe("machine_offline");
    expect(error.message).toContain("dead is offline: connection refused");
    const unlinked = await hub.call("POST", "/m/unlinked/v1/sessions/x/stop");
    expect(unlinked.status).toBe(503);
    const unknown = await hub.call("GET", "/m/Nowhere/v1/sessions");
    expect(unknown.status).toBe(404);
    expect(errorResponseSchema.parse(unknown.json).error.message).toContain("hub-box, Peer A, dead, unlinked");
    expect((await hub.call("GET", "/m/%E0%A4%A/v1/sessions")).status).toBe(400);
  });

  it("registers a device on the hub and forwards it to the peer", async () => {
    await untilPeerLive();
    const token = "a".repeat(64);
    const done = await hub.call("POST", "/m/Peer%20A/v1/devices", { apnsToken: token, environment: "sandbox", name: "phone", notifications: ["done"] });
    expect(done.status).toBe(200);
    const bad = await hub.call("POST", "/m/Peer%20A/v1/devices", { nope: true });
    expect(bad.status).toBe(400);
  });
});

describe("devices of a phone in hub mode", () => {
  const peerFile = (file: string): string => (existsSync(join(peer.config.stateDir, file)) ? readFileSync(join(peer.config.stateDir, file), "utf8") : "");

  it("passes the APNs token registered at the hub on to the linked peers, and still answers when a peer is offline", async () => {
    await untilPeerLive();
    await waitForProblem("dead");
    const apnsToken = "b".repeat(64);
    const done = await hub.call("POST", "/v1/devices", { apnsToken, environment: "sandbox", name: "phone", notifications: ["done"] });
    expect(done.status).toBe(200);
    await waitUntil(() => peerFile("devices.json").includes(apnsToken));
    expect(readFileSync(join(hub.config.stateDir, "devices.json"), "utf8")).toContain(apnsToken);
  });

  it("answers /m/<peer>/v1/auth/devices from the peer, not from the hub's own devices", async () => {
    await hub.close();
    await peer.close();
    peer = await startTestDaemon({ name: "Peer A", ...(await authOverrides()) });
    hub = await startHub(await authOverrides());
    await loginAs(peer, "Peer Phone");
    await loginAs(hub, "Hub Phone");
    await untilPeerLive();
    const names = async (path: string): Promise<string[]> => authDeviceListSchema.parse((await hub.call("GET", path)).json).devices.map((device) => device.name);
    expect(await names("/m/Peer%20A/v1/auth/devices")).toEqual(["Peer Phone"]);
    expect(await names("/m/hub-box/v1/auth/devices")).toEqual(["Hub Phone"]);
    expect(await names("/v1/auth/devices")).toEqual(["Hub Phone"]);
  });
});

describe("auth", () => {
  it("rejects a wrong or missing token with 401 on /v1/hub and /m/", async () => {
    for (const token of [null, "x".repeat(48)]) {
      expect((await hub.call("GET", "/v1/hub", undefined, token)).status).toBe(401);
      expect((await hub.call("GET", "/m/Peer%20A/v1/sessions", undefined, token)).status).toBe(401);
    }
  });

  it("routes /m/<any>/v1/auth/login to the hub's own login without a bearer (501 until a password is set)", async () => {
    for (const machine of ["Peer%20A", "hub-box", "Nowhere"]) {
      const login = await hub.call("POST", `/m/${machine}/v1/auth/login`, { password: "whatever1", deviceName: "cli" }, null);
      expect(login.status).toBe(501);
    }
    expect((await hub.call("GET", "/m/Peer%20A/v1/auth/devices")).status).toBe(200);
  });
});

function openRelay(path: string, token = TEST_TOKEN): { events: StreamEvent[]; ws: WebSocket; opened: Promise<void> } {
  const ws = new WebSocket(`${hub.url.replace("http", "ws")}${path}`, { headers: { authorization: `Bearer ${token}` } });
  const events: StreamEvent[] = [];
  ws.on("message", (data: Buffer) => { events.push(streamEventSchema.parse(JSON.parse(data.toString()))); });
  const opened = new Promise<void>((resolve, reject) => {
    ws.once("open", () => { resolve(); });
    ws.once("error", reject);
  });
  return { events, ws, opened };
}

function upgradeStatus(path: string, token = TEST_TOKEN): Promise<number> {
  const ws = new WebSocket(`${hub.url.replace("http", "ws")}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return new Promise((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => { resolve(response.statusCode ?? 0); });
    ws.once("open", () => { ws.close(); reject(new Error("upgrade accepted")); });
    ws.once("error", () => undefined);
  });
}

describe("stream relay", () => {
  it("sends hello from the cache and relays the peer's session events", async () => {
    await untilPeerLive();
    const relay = openRelay("/m/Peer%20A/v1/stream");
    await relay.opened;
    await waitUntil(() => relay.events.length > 0);
    const hello = relay.events[0];
    expect(hello?.type).toBe("hello");
    if (hello?.type === "hello") expect(hello.machine.name).toBe("Peer A");
    const id = await addSession();
    await waitUntil(() => relay.events.some((event) => event.type === "session" && event.session.id === id));
    relay.ws.close();
  });

  it("serves its own stream under /m/<self>/ and refuses offline, unknown and unauthorised upgrades", async () => {
    const own = openRelay("/m/hub-box/v1/stream");
    await own.opened;
    await waitUntil(() => own.events[0]?.type === "hello");
    own.ws.close();
    await waitForProblem("dead");
    expect(await upgradeStatus("/m/dead/v1/stream")).toBe(503);
    expect(await upgradeStatus("/m/Nowhere/v1/stream")).toBe(404);
    expect(await upgradeStatus("/m/Peer%20A/v1/stream", "x".repeat(48))).toBe(401);
    expect(await upgradeStatus("/m/Peer%20A/v1/elsewhere")).toBe(404);
  });
});

describe("hub disabled", () => {
  it("has no /v1/hub and no /m/ routes", async () => {
    const plain = await startTestDaemon();
    expect((await plain.call("GET", "/v1/hub")).status).toBe(404);
    expect((await plain.call("GET", "/m/test-mac/v1/machine")).status).toBe(404);
    await plain.close();
  });
});
