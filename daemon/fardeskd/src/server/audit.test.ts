import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OTHER_PASSWORD, authOverrides, loginAs } from "../../test/support/auth.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir, waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID, fireHook, pendingRequestId, seedHookSession } from "../../test/support/hookSession.js";
import { AUDIT_FILE, UNAUTHENTICATED_AUDIT_FILE, auditEntrySchema, createAuditLog, readAudit } from "../audit/store.js";
import type { AuditEntry } from "../audit/store.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

const auditLines = (): AuditEntry[] => readAudit(daemon.config.stateDir, null);

describe("audit log through the HTTP API", () => {
  it("writes one line each for a message, a permission decision and a failed login, with the right device id and no message text", async () => {
    daemon = await startTestDaemon(await authOverrides());
    await seedHookSession(daemon);
    const phone = await loginAs(daemon, "Test iPhone");
    const hook = fireHook(daemon, "PermissionRequest-bash.json");
    const requestId = await pendingRequestId(daemon, "permission");
    const secret = "do-not-log-this-prompt-text";
    await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/message`, { text: secret }, phone.token);
    expect((await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/permission/${requestId}`, { decision: "allow" }, phone.token)).status).toBe(200);
    await hook;
    const failed = await daemon.call("POST", "/v1/auth/login", { password: OTHER_PASSWORD, deviceName: "Intruder" }, null);
    expect(failed.status).toBe(401);

    const lines = auditLines();
    const byRoute = (route: string): AuditEntry[] => lines.filter((entry) => entry.route === route);
    const [message] = byRoute("/v1/sessions/:id/message");
    expect(byRoute("/v1/sessions/:id/message")).toHaveLength(1);
    expect(message).toMatchObject({ event: "request", deviceId: phone.deviceId, method: "POST", sessionId: HOOK_SESSION_ID });
    const decisions = byRoute("/v1/sessions/:id/permission/:rid");
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ event: "request", deviceId: phone.deviceId, sessionId: HOOK_SESSION_ID, result: 200 });
    const logins = lines.filter((entry) => entry.event === "login_failed");
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({ deviceId: null, route: "/v1/auth/login", result: 401, ip: "127.0.0.1" });
    expect(readFileSync(join(daemon.config.stateDir, AUDIT_FILE), "utf8")).not.toContain(secret);
    expect(statSync(join(daemon.config.stateDir, AUDIT_FILE)).mode & 0o777).toBe(0o600);
  });

  it("does not log plain reads, and logs a rejected bearer with no device id", async () => {
    daemon = await startTestDaemon();
    await daemon.call("GET", "/v1/machine");
    await daemon.call("POST", "/v1/sessions/nope/mute", { muted: true }, "w".repeat(48));
    await waitUntil(() => auditLines().length === 1);
    expect(auditLines()[0]).toMatchObject({ deviceId: null, method: "POST", result: 401, sessionId: "nope" });
  });
});

describe("audit store", () => {
  it("rotates at a fixed size and reads the rotated file first, filtered by --since", () => {
    const stateDir = makeTempDir("fd-audit-");
    let now = new Date("2026-11-17T10:00:00.000Z");
    const log = createAuditLog({ stateDir, now: () => now, maxBytes: 600 });
    const input = { event: "request" as const, deviceId: "dev_1", method: "POST", route: "/v1/sessions/:id/stop", sessionId: "s1", result: 200, ip: "100.64.0.9" };
    for (let index = 0; index < 10; index += 1) {
      now = new Date(now.getTime() + 60_000);
      log.record(input);
    }
    const all = readAudit(stateDir, null);
    expect(all.length).toBeGreaterThanOrEqual(4);
    expect(all.length).toBeLessThan(10);
    expect(statSync(join(stateDir, AUDIT_FILE)).size).toBeLessThan(600 + 200);
    expect(statSync(join(stateDir, `${AUDIT_FILE}.1`)).size).toBeGreaterThan(0);
    expect(all.map((entry) => entry.time)).toEqual([...all.map((entry) => entry.time)].sort());
    for (const entry of all) auditEntrySchema.parse(entry);
    const recent = readAudit(stateDir, new Date("2026-11-17T10:09:00.000Z"));
    expect(recent.map((entry) => entry.time)).toEqual(["2026-11-17T10:09:00.000Z", "2026-11-17T10:10:00.000Z"]);
  });

  it("keeps the authenticated trail when a caller without a valid bearer floods the log", () => {
    const stateDir = makeTempDir("fd-audit-");
    let now = new Date("2026-11-17T10:00:00.000Z");
    const log = createAuditLog({ stateDir, now: () => now, maxBytes: 600 });
    log.record({ event: "request", deviceId: "dev_1", method: "POST", route: "/v1/sessions/:id/stop", sessionId: "s1", result: 200, ip: "100.64.0.9" });
    for (let index = 0; index < 200; index += 1) {
      now = new Date(now.getTime() + 1000);
      log.record({ event: "login_failed", deviceId: null, method: "POST", route: "/v1/auth/login", sessionId: null, result: 401, ip: "100.64.0.66" });
    }
    now = new Date(now.getTime() + 1000);
    log.record({ event: "request", deviceId: "dev_1", method: "POST", route: "/v1/sessions/:id/mute", sessionId: "s1", result: 200, ip: "100.64.0.9" });
    const all = readAudit(stateDir, null);
    expect(all.filter((entry) => entry.deviceId === "dev_1").map((entry) => entry.route)).toEqual(["/v1/sessions/:id/stop", "/v1/sessions/:id/mute"]);
    expect(all.some((entry) => entry.event === "login_failed")).toBe(true);
    expect(all.map((entry) => entry.time)).toEqual([...all.map((entry) => entry.time)].sort());
    expect(statSync(join(stateDir, UNAUTHENTICATED_AUDIT_FILE)).mode & 0o777).toBe(0o600);
  });
});
