import { afterEach, describe, expect, it } from "vitest";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { runTool } from "../../test/support/coordinator.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { createCoordinatorBackend } from "./backend.js";

const TOKEN_A = "aa".repeat(32);
const TOKEN_B = "bb".repeat(32);
const COORDINATOR_ID = "coordinator-session-id";

let daemon: TestDaemon | null = null;
let server: ApnsTestServer | null = null;

afterEach(async () => {
  await daemon?.close();
  await server?.stop();
  daemon = null;
  server = null;
});

async function start(withPush: boolean): Promise<{ daemon: TestDaemon; server: ApnsTestServer }> {
  server = await startApnsServer();
  daemon = await startTestDaemon({ push: { content: "full" } }, { apns: withPush ? createTestApnsClient(server) : null });
  return { daemon, server };
}

const register = (target: TestDaemon, token: string): void => {
  target.services.registerDevice({ apnsToken: token, environment: "sandbox", name: "iPhone", notifications: [] });
};

const backendOf = (target: TestDaemon, current: string | null = COORDINATOR_ID): ReturnType<typeof createCoordinatorBackend> =>
  createCoordinatorBackend(target.config, target.services, () => current);

describe("notify_phone", () => {
  it("pushes a DONE notification that opens the coordinator session to every registered device", async () => {
    const started = await start(true);
    register(started.daemon, TOKEN_A);
    register(started.daemon, TOKEN_B);
    const result = await runTool(backendOf(started.daemon), "notify_phone", { title: "Build finished", body: "All 3 repos are green." });
    expect(result).toEqual({ text: "sent to 2 devices", isError: false });
    await waitUntil(() => started.server.requests.length === 2);
    expect(started.server.requests.map((request) => request.path).toSorted()).toEqual([`/3/device/${TOKEN_A}`, `/3/device/${TOKEN_B}`]);
    const body = JSON.parse(started.server.requests[0]?.body ?? "{}") as { aps: Record<string, unknown> } & Record<string, string>;
    expect(body.aps).toMatchObject({ alert: { title: "Build finished", body: "All 3 repos are green." }, category: "DONE", "thread-id": COORDINATOR_ID });
    expect(body).toMatchObject({ sessionId: COORDINATOR_ID, machine: "test-mac" });
  });

  it("is a tool error when push is not configured", async () => {
    const started = await start(false);
    register(started.daemon, TOKEN_A);
    const result = await runTool(backendOf(started.daemon), "notify_phone", { title: "t", body: "b" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("push is not configured") as string });
  });

  it("is a tool error when no device is registered", async () => {
    const started = await start(true);
    const result = await runTool(backendOf(started.daemon), "notify_phone", { title: "t", body: "b" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("no device is registered") as string });
    expect(started.server.requests).toHaveLength(0);
  });

  it("is a tool error and sends nothing while the coordinator session has no id", async () => {
    const started = await start(true);
    register(started.daemon, TOKEN_A);
    const result = await runTool(backendOf(started.daemon, null), "notify_phone", { title: "t", body: "b" });
    expect(result).toMatchObject({ isError: true, text: expect.stringContaining("no id yet") as string });
    expect(started.server.requests).toHaveLength(0);
  });
});
