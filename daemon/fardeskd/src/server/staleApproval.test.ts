// #87: no "Needs approval" without something to approve, and no message stuck behind it.
// Real daemon, real hook socket, real registry files, real local APNs server.
import { writeFileSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { hookSocket, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID, fireHook, hookFixtureText, pendingRequestId, seedHookSession } from "../../test/support/hookSession.js";
import { buildHookCommand } from "../hooks/command.js";
import { runHook } from "../../test/support/hookRun.js";
import { createLogger } from "../core/log.js";
import { HAND_OFF_LEAD } from "../push/notifier.js";

let daemon: TestDaemon;
let apnsServer: ApnsTestServer | null = null;
let terminalPid = 0;
let transcriptPath = "";

const DEVICE = { apnsToken: "ef".repeat(32), environment: "sandbox", name: "iPhone", notifications: ["done", "permission"] };

afterEach(async () => {
  await daemon.close();
  await apnsServer?.stop();
  apnsServer = null;
});

async function boot(config: Record<string, unknown>, withApns: boolean, registry: Record<string, unknown> = {}): Promise<void> {
  if (withApns) {
    apnsServer = await startApnsServer();
    const apns = createTestApnsClient(apnsServer);
    daemon = await startTestDaemon(config, { apns, log: createLogger(() => undefined, () => new Date()), doneDelayMs: 0 });
    await daemon.call("POST", "/v1/devices", DEVICE);
  } else {
    daemon = await startTestDaemon(config);
  }
  writeFileSync(join(daemon.home.dir, "settings.json"), JSON.stringify({ crossSessionInbound: "accept" }));
  const seeded = await seedHookSession(daemon, registry);
  terminalPid = seeded.pid;
  transcriptPath = seeded.transcript;
}

const summary = (): { status: string; waitingFor: string | null; summary: string } | undefined =>
  daemon.services.sessions().find((session) => session.id === HOOK_SESSION_ID);

const pendingCount = (): number =>
  daemon.services.activity(HOOK_SESSION_ID, {}).items.filter((item) => item.kind === "permission" && item.state === "pending").length;

function setRegistryStatus(status: string): void {
  daemon.home.addRegistry({ fixture: "busy", sessionId: HOOK_SESSION_ID, pid: terminalPid, overrides: { status, messagingSocketPath: "/tmp/fardesk-test-inbox.sock" } });
}

function alertOf(index: number): { body: string; category: string } {
  const payload = JSON.parse(apnsServer?.requests[index]?.body ?? "{}") as { aps: { alert: { body: string }; category: string } };
  return { body: payload.aps.alert.body, category: payload.aps.category };
}

const pushes = (): NonNullable<typeof apnsServer>["requests"] => apnsServer?.requests ?? [];
const categories = (): string[] => pushes().map((_, index) => alertOf(index).category);
const collapseIds = (): (string | string[] | undefined)[] => pushes().map((recorded) => recorded.headers["apns-collapse-id"]);

// A hook call the test can hang up on, like Claude Code killing the hook's curl when the dialog is answered in the terminal.
function openHookCall(): { hangUp(): void } {
  const call = request({ socketPath: hookSocket(daemon), method: "POST", path: "/hook", headers: { "Content-Type": "application/json" } });
  call.on("error", () => undefined);
  call.end(hookFixtureText("PermissionRequest-bash.json"));
  return { hangUp: (): void => { call.destroy(); } };
}

// The SessionEnd fixture belongs to another session: point it at the seeded one.
async function endSession(): Promise<void> {
  const text = hookFixtureText("SessionEnd-other.json").replaceAll("b0ad2014-b0c8-40ec-9f72-3840f88d1142", HOOK_SESSION_ID);
  await runHook(buildHookCommand(hookSocket(daemon), 5), text);
}

describe("a request that timed out hands off to the terminal", () => {
  it("pushes the hand-off once, shows the terminal state without a fake approval, refuses typed text, and clears with the registry", async () => {
    await boot({ permissionTimeoutSeconds: 1, push: { content: "full" } }, true);
    setRegistryStatus("waiting");
    const run = await fireHook(daemon, "PermissionRequest-bash.json");
    expect(run).toMatchObject({ code: 0, stdout: "" });
    await waitUntil(() => (apnsServer?.requests.length ?? 0) === 2);
    expect(alertOf(0).category).toBe("PERMISSION");
    expect(alertOf(1)).toEqual({ category: "TERMINAL", body: `${HAND_OFF_LEAD}: Bash: touch a1.txt` });

    await waitUntil(() => summary()?.waitingFor === "terminal");
    expect(summary()).toMatchObject({ status: "waiting", summary: "Needs you at the computer" });
    expect(pendingCount()).toBe(0);

    const refused = await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/message`, { text: "hello" });
    expect(refused.status).toBe(409);
    expect(JSON.stringify(refused.json)).toContain("at the computer");

    setRegistryStatus("busy");
    await waitUntil(() => summary()?.waitingFor === null);
    await waitUntil(() => (apnsServer?.requests.length ?? 0) === 3);
    await sleep(300);
    expect(categories()).toEqual(["PERMISSION", "TERMINAL", "RESOLVED"]);
    expect(new Set(collapseIds())).toEqual(new Set([`${HOOK_SESSION_ID}:PERMISSION`]));
    expect(summary()?.status).toBe("working");
  });

  it("answers by phone before the timeout: no hand-off push", async () => {
    await boot({}, true);
    const hook = fireHook(daemon, "PermissionRequest-bash.json");
    const requestId = await pendingRequestId(daemon, "permission");
    await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/permission/${requestId}`, { decision: "allow" });
    await hook;
    await sleep(300);
    expect(categories()).toEqual(["PERMISSION", "RESOLVED"]);
    expect(alertOf(0).category).toBe("PERMISSION");
  });
});

describe("a request resolved anywhere clears the approval at once", () => {
  it("drops the request when the hook connection closes (dialog answered in the terminal)", async () => {
    await boot({}, true);
    const call = openHookCall();
    await pendingRequestId(daemon, "permission");
    await waitUntil(() => summary()?.waitingFor === "permission");
    call.hangUp();
    await waitUntil(() => pendingCount() === 0);
    await waitUntil(() => summary()?.waitingFor === null);
    await sleep(300);
    expect(categories()).toEqual(["PERMISSION", "RESOLVED"]);
  });

  it("drops the request when the transcript shows that exact tool call finished (decided in the terminal)", async () => {
    await boot({}, false);
    const call = openHookCall();
    await pendingRequestId(daemon, "permission");
    const input = { command: "touch a1.txt", description: "Create empty file a1.txt" };
    const stamp = (offsetMs: number): string => new Date(Date.now() + offsetMs).toISOString();
    const entry = (type: string, offsetMs: number, message: Record<string, unknown>): string =>
      JSON.stringify({ type, uuid: `l-${type}`, timestamp: stamp(offsetMs), isSidechain: false, cwd: "/work", message });
    daemon.home.appendLine(transcriptPath, entry("assistant", 0, { role: "assistant", id: "m-tool", model: "claude-test", content: [{ type: "tool_use", id: "tu-87", name: "Bash", input }] }));
    daemon.home.appendLine(transcriptPath, entry("user", 500, { role: "user", content: [{ type: "tool_result", tool_use_id: "tu-87", content: "ok", is_error: false }] }));
    await waitUntil(() => pendingCount() === 0);
    await waitUntil(() => summary()?.waitingFor === null);
    call.hangUp();
  });

  it("drops the request when the session process ended", async () => {
    await boot({}, false);
    const call = openHookCall();
    await pendingRequestId(daemon, "permission");
    daemon.home.removeRegistry(terminalPid);
    await waitUntil(() => pendingCount() === 0);
    call.hangUp();
    await waitUntil(() => summary()?.status === "ended");
    expect(summary()?.waitingFor).toBeNull();
  });

  it("drops the request when the session ends (SessionEnd hook)", async () => {
    await boot({}, false);
    const call = openHookCall();
    await pendingRequestId(daemon, "permission");
    await endSession();
    await waitUntil(() => pendingCount() === 0);
    call.hangUp();
  });
});
