import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { OTHER_PASSWORD, TEST_PASSWORD, authOverrides, loginAs } from "../../test/support/auth.js";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { expectApiError, expectApiOk } from "../../test/support/apiAssert.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { writePasswordHash } from "../config/config.js";
import { authDeviceListSchema, errorResponseSchema, revokeResultSchema } from "../contract/schema.js";
import { createLogger } from "../core/log.js";
import { hashPassword } from "../auth/password.js";

let daemon: TestDaemon;
let apnsServer: ApnsTestServer | null = null;

afterEach(async () => {
  await daemon.close();
  await apnsServer?.stop();
  apnsServer = null;
});

const login = async (name = "iPhone", password = TEST_PASSWORD): Promise<{ status: number; json: unknown }> =>
  daemon.call("POST", "/v1/auth/login", { password, deviceName: name }, null);
const readState = (file: string): string => readFileSync(join(daemon.config.stateDir, file), "utf8");
const listDevices = async (token = TEST_TOKEN): Promise<ReturnType<typeof authDeviceListSchema.parse>["devices"]> =>
  authDeviceListSchema.parse((await daemon.call("GET", "/v1/auth/devices", undefined, token)).json).devices;

describe("login", () => {
  it("returns a device token, the machine and the configured peers, and keeps secrets out of the files", async () => {
    daemon = await startTestDaemon(await authOverrides({}).then((o) => ({ ...o, peers: [{ name: "linux", url: "http://100.64.0.9:4780" }] })));
    const result = await loginAs(daemon, "Test iPhone");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.machine.name).toBe("test-mac");
    expect(result.peers).toEqual([{ name: "linux", url: "http://100.64.0.9:4780" }]);
    expect((await daemon.call("GET", "/v1/machine", undefined, result.token)).status).toBe(200);
    expect(readState("auth-devices.json")).not.toContain(result.token);
    expect(readState("config.json")).not.toContain(TEST_PASSWORD);
    expect(readState("config.json")).toMatch(/"passwordHash":"scrypt\$32768\$8\$1\$/);
  });

  it("answers 401 for a wrong password and never echoes the password in errors", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const wrong = await login("iPhone", OTHER_PASSWORD);
    expect(wrong.status).toBe(401);
    expect(JSON.stringify(wrong.json)).not.toContain(OTHER_PASSWORD);
    const malformed = await daemon.call("POST", "/v1/auth/login", { password: OTHER_PASSWORD, deviceName: "" , extra: 1}, null);
    expect(malformed.status).toBe(400);
    expect(JSON.stringify(malformed.json)).not.toContain(OTHER_PASSWORD);
    expect((await daemon.call("POST", "/v1/auth/login", "{not json", null)).status).toBe(400);
  });

  it("is disabled with 501 until a password is set", async () => {
    daemon = await startTestDaemon();
    const message = await expectApiError(daemon, "POST", "/v1/auth/login", 501, "unsupported", { password: "x", deviceName: "d" });
    expect(message).toContain("fardeskd set-password");
  });

  it("rate limits an IP after maxFailures with 429 and recovers after the window", async () => {
    // 4 s window: each failed attempt hashes the password, and under load 3 attempts took over 1 s,
    // so with a 1 s window the first failure had left it before the 4th check (401 instead of 429).
    daemon = await startTestDaemon(await authOverrides({ maxFailures: 3, windowSeconds: 4 }));
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await login("d", OTHER_PASSWORD)).status).toBe(401);
    expect((await login("d", OTHER_PASSWORD)).status).toBe(429);
    expect((await login()).status).toBe(429);
    await sleep(4100);
    expect((await login()).status).toBe(200);
  });
});

describe("device tokens", () => {
  it("work on normal routes, the master token still works, anything else is 401 unauthorized", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const { token } = await loginAs(daemon, "Mac");
    expect((await daemon.call("GET", "/v1/sessions", undefined, token)).status).toBe(200);
    expect((await daemon.call("GET", "/v1/sessions")).status).toBe(200);
    await expectApiError({ ...daemon, call: async (m, p, b) => daemon.call(m, p, b, "0".repeat(64)) }, "GET", "/v1/sessions", 401, "unauthorized");
    expect((await daemon.call("GET", "/v1/sessions", undefined, null)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/auth/devices", undefined, null)).status).toBe(401);
  });

  it("logout revokes the token (next call is token_revoked) and the master token cannot log out", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const { token } = await loginAs(daemon, "Mac");
    expect((await daemon.call("POST", "/v1/auth/logout", { apnsToken: null }, token)).json).toEqual({ ok: true });
    const after = await daemon.call("GET", "/v1/machine", undefined, token);
    expect(after.status).toBe(401);
    expect(errorResponseSchema.parse(after.json).error.code).toBe("token_revoked");
    await expectApiError(daemon, "POST", "/v1/auth/logout", 400, "invalid_request", { apnsToken: null });
  });

  it("marks the caller as current and tracks last seen and last IP", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const phone = await loginAs(daemon, "Phone");
    const laptop = await loginAs(daemon, "Laptop");
    await daemon.call("GET", "/v1/machine", undefined, laptop.token);
    const seen = await listDevices(phone.token);
    expect(seen.map((device) => [device.name, device.current, device.revoked])).toEqual([["Phone", true, false], ["Laptop", false, false]]);
    expect(seen.every((device) => device.lastIp === "127.0.0.1" && device.lastSeenAt !== null)).toBe(true);
    expect((await listDevices()).some((device) => device.current)).toBe(false);
  });
});

describe("revoke", () => {
  it("revokes one device by name, one by id, then all, and rejects unknown ones", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const [a, b, c] = [await loginAs(daemon, "Alpha"), await loginAs(daemon, "Beta"), await loginAs(daemon, "Gamma")];
    const byName = await daemon.call("POST", "/v1/auth/revoke", { device: "alpha" });
    expect(revokeResultSchema.parse(byName.json)).toEqual({ revoked: 1 });
    expect((await daemon.call("GET", "/v1/machine", undefined, a.token)).status).toBe(401);
    expect(revokeResultSchema.parse((await daemon.call("POST", "/v1/auth/revoke", { device: b.deviceId })).json)).toEqual({ revoked: 1 });
    await expectApiError(daemon, "POST", "/v1/auth/revoke", 404, "not_found", { device: "nobody" });
    expect((await daemon.call("GET", "/v1/machine", undefined, c.token)).status).toBe(200);
    expect(revokeResultSchema.parse((await daemon.call("POST", "/v1/auth/revoke", { device: null })).json)).toEqual({ revoked: 1 });
    const final = await daemon.call("GET", "/v1/machine", undefined, c.token);
    expect(errorResponseSchema.parse(final.json).error.code).toBe("token_revoked");
    expect((await listDevices()).every((device) => device.revoked)).toBe(true);
    expect((await daemon.call("GET", "/v1/machine")).status).toBe(200);
  });
});

describe("stream", () => {
  it("accepts a device token, refuses a revoked one with token_revoked, and closes open sockets on revoke", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const { token, deviceId } = await loginAs(daemon, "Phone");
    const stream = await daemon.openStream(token);
    await waitUntil(() => stream.events.length === 1);
    const closed = new Promise<number>((resolve) => stream.ws.once("close", (code: number) => { resolve(code); }));
    await daemon.call("POST", "/v1/auth/revoke", { device: deviceId });
    expect(await closed).toBe(1008);
    const body = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`${daemon.url.replace("http", "ws")}/v1/stream`, { headers: { authorization: `Bearer ${token}` } });
      ws.once("unexpected-response", (_request, response) => {
        let text = "";
        response.on("data", (chunk: Buffer) => { text += chunk.toString("utf8"); });
        response.on("end", () => { resolve(`${response.statusCode}:${text}`); });
      });
      ws.once("open", () => { reject(new Error("accepted a revoked token")); });
      ws.once("error", () => undefined);
    });
    expect(body.startsWith("401:")).toBe(true);
    expect(errorResponseSchema.parse(JSON.parse(body.slice(4))).error.code).toBe("token_revoked");
  });
});

describe("password change and reload", () => {
  it("verifies the current password, revokes every device token and switches to the new password at once", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const { token } = await loginAs(daemon, "Phone");
    await expectApiError(daemon, "POST", "/v1/auth/password", 401, "unauthorized", { current: OTHER_PASSWORD, next: "brand new password" });
    expect((await daemon.call("GET", "/v1/machine", undefined, token)).status).toBe(200);
    await expectApiOk(daemon, "/v1/auth/password", { current: TEST_PASSWORD, next: "brand new password" });
    expect(errorResponseSchema.parse((await daemon.call("GET", "/v1/machine", undefined, token)).json).error.code).toBe("token_revoked");
    expect((await login("Phone", TEST_PASSWORD)).status).toBe(401);
    expect((await login("Phone", "brand new password")).status).toBe(200);
    const config = readState("config.json");
    expect(config).not.toContain("brand new password");
    expect((JSON.parse(config) as { name: string }).name).toBe("test-mac");
  });

  it("rate limits wrong current passwords too and rejects a too short new one", async () => {
    daemon = await startTestDaemon(await authOverrides({ maxFailures: 2 }));
    await expectApiError(daemon, "POST", "/v1/auth/password", 400, "invalid_request", { current: TEST_PASSWORD, next: "short" });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectApiError(daemon, "POST", "/v1/auth/password", 401, "unauthorized", { current: OTHER_PASSWORD, next: "brand new password" });
    }
    await expectApiError(daemon, "POST", "/v1/auth/password", 429, "rate_limited", { current: TEST_PASSWORD, next: "brand new password" });
  });

  it("reload re-reads the hash from the config file and revokes all tokens", async () => {
    daemon = await startTestDaemon(await authOverrides());
    const { token } = await loginAs(daemon, "Phone");
    writePasswordHash(join(daemon.config.stateDir, "config.json"), await hashPassword(OTHER_PASSWORD));
    await expectApiOk(daemon, "/v1/auth/reload");
    expect((await daemon.call("GET", "/v1/machine", undefined, token)).status).toBe(401);
    expect((await login("Phone", TEST_PASSWORD)).status).toBe(401);
    expect((await login("Phone", OTHER_PASSWORD)).status).toBe(200);
  });
});

describe("wipe push", () => {
  it("sends the silent wipe push to a revoked device with an attached push token and forgets its registration", async () => {
    apnsServer = await startApnsServer();
    const apns = createTestApnsClient(apnsServer);
    daemon = await startTestDaemon(await authOverrides(), { apns, log: createLogger(() => undefined, () => new Date()) });
    const { token } = await loginAs(daemon, "Phone");
    const apnsToken = "ab".repeat(32);
    await daemon.call("POST", "/v1/devices", { apnsToken, environment: "sandbox", name: "Phone", notifications: ["done"] }, token);
    expect(readState("auth-devices.json")).toContain(apnsToken);
    expect(readState("devices.json")).toContain(apnsToken);
    await daemon.call("POST", "/v1/auth/revoke", { device: "Phone" });
    const wipes = apnsServer.requests.filter((request) => request.headers["apns-push-type"] === "background");
    expect(wipes).toHaveLength(1);
    expect(wipes[0]?.path).toBe(`/3/device/${apnsToken}`);
    expect(JSON.parse(wipes[0]?.body ?? "")).toEqual({ aps: { "content-available": 1 }, command: "wipe" });
    expect(readState("devices.json")).not.toContain(apnsToken);
    apns.close();
  });

  it("logout removes the push registration without a wipe push", async () => {
    apnsServer = await startApnsServer();
    const apns = createTestApnsClient(apnsServer);
    daemon = await startTestDaemon(await authOverrides(), { apns });
    const { token } = await loginAs(daemon, "Phone");
    const apnsToken = "cd".repeat(32);
    await daemon.call("POST", "/v1/devices", { apnsToken, environment: "sandbox", name: "Phone", notifications: [] }, token);
    await daemon.call("POST", "/v1/auth/logout", { apnsToken }, token);
    expect(readState("devices.json")).not.toContain(apnsToken);
    expect(apnsServer.requests).toHaveLength(0);
    apns.close();
  });
});
