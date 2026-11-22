import { afterEach, describe, expect, it } from "vitest";
import { APNS_TEST_CERT as CERT, startApnsServer as startServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer as TestServer } from "../../test/support/apnsServer.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { WIPE_COMMAND } from "../contract/schema.js";
import { APNS_HOSTS, ApnsError, buildPayload, createApnsClient, isDeadTokenError } from "./apns.js";
import type { ApnsClient, ApnsNotification } from "./apns.js";

const DEVICE = "ab".repeat(32);

const NOTIFICATION: ApnsNotification = {
  title: "Needs permission",
  body: "Run npm test?",
  category: "PERMISSION",
  threadId: "session-1",
  data: { sessionId: "s1", requestId: "r1" },
};

const tokenSource = { token: (): string => "jwt-token" };
const servers: TestServer[] = [];
const clients: ApnsClient[] = [];

async function setup(): Promise<{ sandbox: TestServer; production: TestServer; client: ApnsClient }> {
  const sandbox = await startServer();
  const production = await startServer();
  servers.push(sandbox, production);
  const client = createApnsClient({
    tokenSource,
    topic: "com.example.fardesk",
    hosts: { sandbox: sandbox.host, production: production.host },
    ca: CERT,
  });
  clients.push(client);
  return { sandbox, production, client };
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) await server.stop();
});

describe("apns client", () => {
  it("exports the real Apple hosts", () => {
    expect(APNS_HOSTS).toEqual({ sandbox: "https://api.sandbox.push.apple.com", production: "https://api.push.apple.com" });
  });

  it("posts the alert with the required headers and body", async () => {
    const { sandbox, production, client } = await setup();
    await client.send(DEVICE, "sandbox", { ...NOTIFICATION, collapseId: "perm-1" });
    expect(production.requests).toHaveLength(0);
    const [request] = sandbox.requests;
    expect(request?.path).toBe(`/3/device/${DEVICE}`);
    expect(request?.headers[":method"]).toBe("POST");
    expect(request?.headers.authorization).toBe("bearer jwt-token");
    expect(request?.headers["apns-topic"]).toBe("com.example.fardesk");
    expect(request?.headers["apns-push-type"]).toBe("alert");
    expect(request?.headers["apns-priority"]).toBe("10");
    expect(request?.headers["apns-collapse-id"]).toBe("perm-1");
    expect(JSON.parse(request?.body ?? "")).toEqual({
      aps: {
        alert: { title: "Needs permission", body: "Run npm test?" },
        sound: "default",
        category: "PERMISSION",
        "thread-id": "session-1",
        "interruption-level": "time-sensitive",
      },
      sessionId: "s1",
      requestId: "r1",
    });
  });

  it("sends a resolved notice passive, silent and at low priority, with the same collapse id", async () => {
    const { sandbox, client } = await setup();
    await client.send(DEVICE, "sandbox", { ...NOTIFICATION, category: "RESOLVED", collapseId: "s1:PERMISSION", data: { sessionId: "s1", requestId: "r1", kind: "resolved" } });
    const [request] = sandbox.requests;
    expect(request?.headers["apns-priority"]).toBe("5");
    expect(request?.headers["apns-collapse-id"]).toBe("s1:PERMISSION");
    expect(JSON.parse(request?.body ?? "")).toEqual({
      aps: { alert: { title: "Needs permission", body: "Run npm test?" }, category: "RESOLVED", "thread-id": "session-1", "interruption-level": "passive" },
      sessionId: "s1",
      requestId: "r1",
      kind: "resolved",
    });
  });

  it("uses the production host, omits the collapse id and sets interruption levels", async () => {
    const { sandbox, production, client } = await setup();
    await client.send(DEVICE, "production", { ...NOTIFICATION, category: "DONE" });
    await client.send(DEVICE, "production", { ...NOTIFICATION, category: "QUESTION" });
    expect(sandbox.requests).toHaveLength(0);
    expect(production.requests[0]?.headers["apns-collapse-id"]).toBeUndefined();
    const levels = production.requests.map((r) => (JSON.parse(r.body) as { aps: Record<string, string> }).aps["interruption-level"]);
    expect(levels).toEqual(["active", "time-sensitive"]);
    expect(JSON.parse(buildPayload({ ...NOTIFICATION, category: "ENDED" }))).toHaveProperty("aps.interruption-level", "active");
  });

  it("sends a silent background push with priority 5 and the wipe command, and maps errors like send", async () => {
    const { sandbox, client } = await setup();
    await client.sendBackground(DEVICE, "sandbox", { command: WIPE_COMMAND });
    const request = sandbox.requests[0];
    expect(request?.path).toBe(`/3/device/${DEVICE}`);
    expect(request?.headers["apns-push-type"]).toBe("background");
    expect(request?.headers["apns-priority"]).toBe("5");
    expect(request?.headers["apns-topic"]).toBe("com.example.fardesk");
    expect(JSON.parse(request?.body ?? "")).toEqual({ aps: { "content-available": 1 }, command: "wipe" });
    sandbox.script.push({ status: 410, body: JSON.stringify({ reason: "Unregistered" }) });
    await expect(client.sendBackground(DEVICE, "sandbox", { command: WIPE_COMMAND })).rejects.toBeInstanceOf(ApnsError);
  });

  it("reuses one session for two sends and reconnects after the server closes it", async () => {
    const { sandbox, client } = await setup();
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    expect(sandbox.sessions).toBe(1);
    sandbox.script.push({ status: 200, body: "", closeSession: true });
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    await waitUntil(() => sandbox.closed === 1);
    await sleep(100);
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    expect(sandbox.sessions).toBe(2);
    expect(sandbox.requests).toHaveLength(4);
  });

  it("maps non-200 answers to ApnsError", async () => {
    const { sandbox, client } = await setup();
    sandbox.script.push(
      { status: 400, body: JSON.stringify({ reason: "BadDeviceToken" }) },
      { status: 410, body: JSON.stringify({ reason: "Unregistered" }) },
      { status: 403, body: JSON.stringify({ reason: "ExpiredProviderToken" }) },
      { status: 500, body: "<html>oops</html>" },
      { status: 500, body: JSON.stringify({ nope: 1 }) },
    );
    const errors: ApnsError[] = [];
    for (let i = 0; i < 5; i += 1) {
      errors.push((await client.send(DEVICE, "sandbox", NOTIFICATION).catch((e: unknown) => e)) as ApnsError);
    }
    expect(errors.every((error) => error instanceof ApnsError)).toBe(true);
    expect(errors.map((e) => [e.status, e.reason])).toEqual([
      [400, "BadDeviceToken"],
      [410, "Unregistered"],
      [403, "ExpiredProviderToken"],
      [500, "UnparseableResponse"],
      [500, "UnparseableResponse"],
    ]);
    expect(errors[0]?.message).toBe("APNs rejected the push: 400 BadDeviceToken");
    expect(errors.map(isDeadTokenError)).toEqual([true, true, false, false, false]);
  });

  it("treats a bare 410 and foreign errors correctly", () => {
    expect(isDeadTokenError(new ApnsError(410, "ExpiredToken"))).toBe(true);
    expect(isDeadTokenError(new Error("BadDeviceToken"))).toBe(false);
    expect(isDeadTokenError("BadDeviceToken")).toBe(false);
  });

  it("rejects when the host is unreachable and tries again on the next send", async () => {
    const dead = await startServer();
    await dead.stop();
    const client = createApnsClient({ tokenSource, topic: "t", hosts: { sandbox: dead.host, production: dead.host }, ca: CERT });
    clients.push(client);
    await expect(client.send(DEVICE, "sandbox", NOTIFICATION)).rejects.toThrow();
    await expect(client.send(DEVICE, "sandbox", NOTIFICATION)).rejects.toThrow();
  });

  it("connects without a custom CA and fails the handshake against the self-signed server", async () => {
    const server = await startServer();
    servers.push(server);
    const client = createApnsClient({ tokenSource, topic: "t", hosts: { sandbox: server.host, production: server.host } });
    clients.push(client);
    await expect(client.send(DEVICE, "sandbox", NOTIFICATION)).rejects.toThrow();
    expect(server.requests).toHaveLength(0);
  });

  it("close() ends every session so the server sees them close", async () => {
    const { sandbox, production, client } = await setup();
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    await client.send(DEVICE, "production", NOTIFICATION);
    client.close();
    await waitUntil(() => sandbox.closed === 1 && production.closed === 1);
    await client.send(DEVICE, "sandbox", NOTIFICATION);
    expect(sandbox.sessions).toBe(2);
  });
});
