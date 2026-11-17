import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { startTestDaemon, testConfig, writeConfigFile } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { freePort, makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { fireHook, hookFixtureText, seedHookSession } from "../../test/support/hookSession.js";
import { createLogger } from "../core/log.js";
import { buildHookCommand } from "../hooks/command.js";
import { runHook } from "../../test/support/hookRun.js";
import { FardeskError } from "../core/errors.js";
import { hookSocket } from "../../test/support/daemon.js";
import { createRealOwned } from "./ownedFactory.js";
import { createServices } from "./services.js";

let daemon: TestDaemon | null = null;
let apnsServer: ApnsTestServer | null = null;

afterEach(async () => {
  await daemon?.close();
  await apnsServer?.stop();
  daemon = null;
  apnsServer = null;
});

const DEVICE = { apnsToken: "ef".repeat(32), environment: "sandbox", name: "iPhone", notifications: ["done", "permission"] };

async function bootWithApns(logLines: string[] = [], content: "generic" | "full" = "full"): Promise<TestDaemon> {
  apnsServer = await startApnsServer();
  const apns = createTestApnsClient(apnsServer);
  const log = createLogger((line) => logLines.push(line), () => new Date());
  daemon = await startTestDaemon({ push: { content } }, { apns, log, doneDelayMs: 0 });
  await daemon.call("POST", "/v1/devices", DEVICE);
  return daemon;
}

function sentAlert(index: number): { title: string; body: string; category: string } {
  const payload = JSON.parse(apnsServer?.requests[index]?.body ?? "{}") as { aps: { alert: { title: string; body: string }; category: string } };
  return { ...payload.aps.alert, category: payload.aps.category };
}

describe("hook events", () => {
  it("pushes a done notification for a Stop hook with the last assistant message", async () => {
    const booted = await bootWithApns();
    await seedHookSession(booted, { status: "idle" });
    const run = await fireHook(booted, "Stop.json");
    expect(run.code).toBe(0);
    await waitUntil(() => (apnsServer?.requests.length ?? 0) === 1);
    expect(sentAlert(0)).toMatchObject({ category: "DONE", body: expect.stringContaining("touch a1.txt") as string });
    expect(sentAlert(0).title).toBe(booted.services.sessions()[0]?.title);
  });

  it("pushes only a generic line by default: no session title or assistant text reaches APNs", async () => {
    const booted = await bootWithApns([], "generic");
    await seedHookSession(booted, { status: "idle" });
    expect((await fireHook(booted, "Stop.json")).code).toBe(0);
    await waitUntil(() => (apnsServer?.requests.length ?? 0) === 1);
    expect(sentAlert(0)).toEqual({ title: "Fardesk", body: "A session on test-mac is done", category: "DONE" });
    expect(apnsServer?.requests[0]?.body).not.toContain("touch a1.txt");
  });

  it("pushes nothing for a Stop of a session it does not know (a Claude process outside its Claude homes)", async () => {
    const booted = await bootWithApns();
    await runHook(buildHookCommand(hookSocket(booted), 5), '{"session_id":"unknown-session","hook_event_name":"Stop"}');
    await sleep(300);
    expect(apnsServer?.requests ?? []).toHaveLength(0);
  });

  it("refreshes the session list at once on SessionStart and SessionEnd", async () => {
    daemon = await startTestDaemon({ intervals: { registryPollMs: 600_000, transcriptPollMs: 50, pingMs: 60_000 } });
    const sessionId = "efefefef-efef-4fef-8fef-efefefefefef";
    daemon.home.addRegistry({ fixture: "idle", sessionId });
    expect(daemon.services.sessions()).toEqual([]);
    await fireHook(daemon, "SessionStart.json");
    expect(daemon.services.sessions().map((session) => session.id)).toEqual([sessionId]);
    daemon.home.removeRegistry(daemon.services.sessions()[0]?.pid ?? 0);
    await fireHook(daemon, "SessionEnd-other.json");
    expect(daemon.services.sessions()).toEqual([]);
  });

  it("ignores events it does not handle and permission requests without a tool", async () => {
    const lines: string[] = [];
    daemon = await startTestDaemon({}, { log: createLogger((line) => lines.push(line), () => new Date()) });
    expect(await fireHook(daemon, "Notification.json")).toMatchObject({ code: 0, stdout: "" });
    const incomplete = await runHook(buildHookCommand(hookSocket(daemon), 5), '{"session_id":"s","hook_event_name":"PermissionRequest"}');
    expect(incomplete).toMatchObject({ code: 0, stdout: "" });
    expect(lines.some((line) => line.includes("hook_permission_request_incomplete"))).toBe(true);
    expect(hookFixtureText("Notification.json")).toContain("Notification");
  });
});

describe("startup", () => {
  it("builds the APNs client from the config and closes it with the services", async () => {
    const home = createClaudeHome();
    const keyPath = join(makeTempDir(), "AuthKey.p8");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }));
    const config = testConfig(home, await freePort(), { apns: { keyPath, keyId: "KEY1234567", teamId: "TEAM123456", topic: "com.example.fardesk" } });
    const services = await createServices(config, { createOwned: createRealOwned, configPath: writeConfigFile(config), log: createLogger(() => undefined, () => new Date()) });
    await services.close();
    home.dispose();
  });

  it("releases what it built when a later step fails", async () => {
    const home = createClaudeHome();
    const config = testConfig(home, await freePort(), { stateDir: join(makeTempDir(), "x".repeat(120)) });
    await expect(createServices(config, { createOwned: createRealOwned, configPath: writeConfigFile(config), log: createLogger(() => undefined, () => new Date()) })).rejects.toThrow();
    home.dispose();
  });

  it("refuses to build owned sessions without a Claude home", async () => {
    const home = createClaudeHome();
    const config = testConfig(home, await freePort(), { claudeHomes: [] });
    await expect(createServices(config, { createOwned: createRealOwned, configPath: writeConfigFile(config) })).rejects.toThrow(FardeskError);
    home.dispose();
  });
});
