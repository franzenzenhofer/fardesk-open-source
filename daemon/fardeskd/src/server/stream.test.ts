import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { machineSchema, sessionSummarySchema } from "../contract/schema.js";
import { sessionSummaryFixtures } from "../contract/fixturesSessions.js";
import type { StreamEvent } from "../contract/schema.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

async function statusOfUpgrade(url: string, headers: Record<string, string>): Promise<number> {
  const ws = new WebSocket(url, { headers });
  return new Promise((resolve, reject) => {
    ws.once("unexpected-response", (_request, response) => { resolve(response.statusCode ?? 0); });
    ws.once("open", () => { reject(new Error("upgrade was accepted")); });
    ws.once("error", () => undefined);
  });
}

const bigActivity = (index: number): StreamEvent => ({
  type: "activity",
  sessionId: "s",
  activity: { id: `a${index}`, ts: "2026-11-15T10:00:00.000Z", kind: "assistant", text: "x".repeat(200_000) },
});

describe("authentication and paths", () => {
  it("refuses an upgrade without or with a wrong token (401) and on another path (404)", async () => {
    daemon = await startTestDaemon();
    const base = daemon.url.replace("http", "ws");
    expect(await statusOfUpgrade(`${base}/v1/stream`, {})).toBe(401);
    expect(await statusOfUpgrade(`${base}/v1/stream`, { authorization: "Bearer wrong" })).toBe(401);
    expect(await statusOfUpgrade(`${base}/v1/elsewhere`, { authorization: `Bearer ${TEST_TOKEN}` })).toBe(404);
  });
});

describe("events", () => {
  it("sends hello first, then session and activity events, and closes with the daemon", async () => {
    daemon = await startTestDaemon();
    const stream = await daemon.openStream();
    await waitUntil(() => stream.events.length === 1);
    const hello = stream.events[0];
    expect(hello?.type).toBe("hello");
    if (hello?.type === "hello") {
      expect(machineSchema.parse(hello.machine).name).toBe("test-mac");
      expect(hello.sessions).toEqual([]);
    }
    daemon.home.addRegistry({ fixture: "idle", sessionId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd" });
    await waitUntil(() => stream.events.some((event) => event.type === "session"));
    daemon.services.bus.publish(bigActivity(1));
    await waitUntil(() => stream.events.some((event) => event.type === "activity"));
    const closed = new Promise<void>((resolve) => stream.ws.once("close", () => { resolve(); }));
    await daemon.server.close();
    await closed;
  });

  it("pings at the configured interval", async () => {
    daemon = await startTestDaemon({}, {}, { pingMs: 40 });
    const stream = await daemon.openStream();
    await waitUntil(() => stream.events.filter((event) => event.type === "ping").length >= 2);
  });
});

describe("session events and the client's list", () => {
  const base = sessionSummarySchema.parse(sessionSummaryFixtures.working);
  const live = { ...base, id: "sess_live", cwd: tmpdir() };
  const hidden = { ...base, id: "sess_hidden", status: "ended" as const, canStop: false, replyMode: "resume" as const, cwd: "/nonexistent/fardesk-test-folder" };
  const sessionIds = (events: StreamEvent[]): string[] => events.flatMap((event) => (event.type === "session" ? [event.session.id] : []));

  it("sends no session event for an ended session the list hides, and keeps sending live ones", async () => {
    daemon = await startTestDaemon({ sessions: { tidyList: true } });
    const stream = await daemon.openStream();
    await waitUntil(() => stream.events.length === 1);
    daemon.services.bus.publish({ type: "session", session: hidden });
    daemon.services.bus.publish({ type: "session", session: live });
    await waitUntil(() => sessionIds(stream.events).includes("sess_live"));
    expect(sessionIds(stream.events)).toEqual(["sess_live"]);
  });

  it("still tells the client that a session it knew ended, even when that session left the list", async () => {
    daemon = await startTestDaemon({ sessions: { tidyList: true } });
    const stream = await daemon.openStream();
    await waitUntil(() => stream.events.length === 1);
    daemon.services.bus.publish({ type: "session", session: { ...hidden, status: "working", canStop: true } });
    daemon.services.bus.publish({ type: "session", session: hidden });
    daemon.services.bus.publish({ type: "session", session: hidden });
    daemon.services.bus.publish({ type: "session", session: live });
    await waitUntil(() => sessionIds(stream.events).includes("sess_live"));
    expect(sessionIds(stream.events)).toEqual(["sess_hidden", "sess_hidden", "sess_live"]);
    expect(stream.events.filter((event) => event.type === "session" && event.session.status === "ended")).toHaveLength(1);
  });
});

describe("slow clients", () => {
  it("terminates a client that does not read once its buffer passes the limit", async () => {
    daemon = await startTestDaemon({}, {}, { maxBufferedBytes: 50_000 });
    const socket = connect(daemon.server.port, "127.0.0.1");
    await new Promise<void>((resolve) => socket.once("connect", () => { resolve(); }));
    const handshake = [
      "GET /v1/stream HTTP/1.1",
      "Host: 127.0.0.1",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
      "Sec-WebSocket-Version: 13",
      `Authorization: Bearer ${TEST_TOKEN}`,
      "",
      "",
    ].join("\r\n");
    socket.write(handshake);
    await new Promise<void>((resolve) => socket.once("data", () => { resolve(); }));
    socket.pause();
    for (let index = 0; index < 100; index += 1) daemon.services.bus.publish(bigActivity(index));
    let received = 0;
    socket.on("data", (chunk) => { received += chunk.length; });
    const ended = new Promise<void>((resolve) => socket.once("close", () => { resolve(); }));
    socket.resume();
    await ended;
    expect(received).toBeLessThan(100 * 200_000);
  });
});
