// The PermissionRequest hook against a real broker and a real notifier talking to a local APNs server (#87).
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { APNS_TEST_CERT, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { hookFixtureText } from "../../test/support/hookSession.js";
import { createBus } from "../core/bus.js";
import { createLogger } from "../core/log.js";
import { parseHookPayload } from "../hooks/payload.js";
import type { HookEvent } from "../hooks/payload.js";
import { createBroker } from "../permissions/broker.js";
import type { Broker } from "../permissions/broker.js";
import { createApnsClient } from "../push/apns.js";
import type { ApnsClient } from "../push/apns.js";
import { createDeviceStore } from "../push/deviceStore.js";
import { createNotifier } from "../push/notifier.js";
import type { Notifier } from "../push/notifier.js";
import { createHookHandler } from "./hooks.js";

const NOW = "2026-11-15T10:00:00.000Z";
const TOKEN = "cd".repeat(32);
const TIMEOUT_MS = 150;

const resources: { server: ApnsTestServer; client: ApnsClient; notifier: Notifier; broker: Broker }[] = [];

afterEach(async () => {
  for (const { server, client, notifier, broker } of resources.splice(0)) {
    broker.close();
    notifier.close();
    client.close();
    await server.stop();
  }
});

async function setup(deviceKinds: ("permission" | "question")[]): Promise<{
  handle: ReturnType<typeof createHookHandler>;
  broker: Broker;
  server: ApnsTestServer;
}> {
  const server = await startApnsServer();
  const client = createApnsClient({
    tokenSource: { token: (): string => "jwt" },
    topic: "com.example.fardesk",
    hosts: { sandbox: server.host, production: server.host },
    ca: APNS_TEST_CERT,
  });
  const bus = createBus();
  const log = createLogger(() => undefined, () => new Date(NOW));
  const devices = createDeviceStore(join(makeTempDir(), "devices.json"), () => new Date(NOW));
  devices.upsert({ apnsToken: TOKEN, environment: "sandbox", name: "iPhone", notifications: deviceKinds });
  const notifier = createNotifier({
    bus,
    apns: client,
    devices,
    describe: (id) => ({ title: `Title of ${id}`, summary: "" }),
    isMuted: () => false,
    notificationsEnabled: ["done", "permission", "question", "ended"],
    machineName: "mac-mini",
    content: "full",
    log,
  });
  const broker = createBroker({ timeoutMs: TIMEOUT_MS, bus, now: () => new Date(NOW), newId: () => "req-1", allowBypass: true });
  resources.push({ server, client, notifier, broker });
  const handle = createHookHandler({ broker, owned: { isOwned: () => false }, store: { refresh: () => undefined }, notifier, log });
  return { handle, broker, server };
}

function eventOf(fixture: string): HookEvent {
  const parsed = parseHookPayload(JSON.parse(hookFixtureText(fixture)));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.event;
}

const categories = (server: ApnsTestServer): string[] =>
  server.requests.map((request) => (JSON.parse(request.body) as { aps: { category: string } }).aps.category);

describe("a hook connection that closed before the request was asked", () => {
  it("drops the request at once and sends no hand-off push (the PERMISSION push is only withdrawn by a RESOLVED one)", async () => {
    const { handle, broker, server } = await setup(["permission"]);
    const event = eventOf("PermissionRequest-bash.json");
    const closed = AbortSignal.abort();
    const reply = await handle(event, closed);
    expect(reply).toEqual({ output: null });
    expect(broker.pendingKind(event.sessionId)).toBeNull();
    expect(broker.activities(event.sessionId)[0]).toMatchObject({ state: "expired" });
    await sleep(TIMEOUT_MS * 2);
    expect(categories(server)).toEqual(["PERMISSION", "RESOLVED"]);
  });
});

describe("the hand-off push follows the kind of the request that timed out", () => {
  it("reaches a device that enabled only questions when a question timed out", async () => {
    const { handle, server } = await setup(["question"]);
    await handle(eventOf("PermissionRequest-askuserquestion.json"), new AbortController().signal);
    await waitUntil(() => server.requests.length === 2);
    expect(categories(server)).toEqual(["QUESTION", "TERMINAL"]);
  });

  it("does not reach a device that enabled only questions when a permission timed out", async () => {
    const { handle, server } = await setup(["question"]);
    await handle(eventOf("PermissionRequest-bash.json"), new AbortController().signal);
    await sleep(TIMEOUT_MS);
    expect(server.requests).toHaveLength(0);
  });
});
