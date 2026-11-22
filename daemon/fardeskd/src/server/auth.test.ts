import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { pairAs } from "../../test/support/auth.js";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { expectApiError } from "../../test/support/apiAssert.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { authDeviceListSchema, errorResponseSchema, revokeResultSchema } from "../contract/schema.js";
import { createLogger } from "../core/log.js";

let daemon: TestDaemon;
let apnsServer: ApnsTestServer | null = null;

afterEach(async () => {
  await daemon.close();
  await apnsServer?.stop();
  apnsServer = null;
});

const readState = (file: string): string => readFileSync(join(daemon.config.stateDir, file), "utf8");
const listDevices = async (token = TEST_TOKEN): Promise<ReturnType<typeof authDeviceListSchema.parse>["devices"]> =>
  authDeviceListSchema.parse((await daemon.call("GET", "/v1/auth/devices", undefined, token)).json).devices;

describe("pairing is the only way to a device token", () => {
  it("returns a device token, the machine and the configured peers, and keeps the token out of the files", async () => {
    daemon = await startTestDaemon({ peers: [{ name: "linux", url: "http://100.64.0.9:4780" }] });
    const result = await pairAs(daemon, "Test iPhone");
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.machine.name).toBe("test-mac");
    expect(result.peers).toEqual([{ name: "linux", url: "http://100.64.0.9:4780" }]);
    expect((await daemon.call("GET", "/v1/machine", undefined, result.token)).status).toBe(200);
    expect(readState("auth-devices.json")).not.toContain(result.token);
  });

  it("has no login, password change or reload route", async () => {
    daemon = await startTestDaemon();
    for (const path of ["/v1/auth/login", "/v1/auth/password", "/v1/auth/reload"]) {
      expect((await daemon.call("POST", path, { password: "x", deviceName: "d" }, null)).status).toBe(401);
      expect((await daemon.call("POST", path, { password: "x", deviceName: "d" })).status).toBe(404);
    }
  });
});

describe("device tokens", () => {
  it("work on normal routes, the master token still works, anything else is 401 unauthorized", async () => {
    daemon = await startTestDaemon();
    const { token } = await pairAs(daemon, "Mac");
    expect((await daemon.call("GET", "/v1/sessions", undefined, token)).status).toBe(200);
    expect((await daemon.call("GET", "/v1/sessions")).status).toBe(200);
    await expectApiError({ ...daemon, call: async (m, p, b) => daemon.call(m, p, b, "0".repeat(64)) }, "GET", "/v1/sessions", 401, "unauthorized");
    expect((await daemon.call("GET", "/v1/sessions", undefined, null)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/auth/devices", undefined, null)).status).toBe(401);
  });

  it("logout revokes the token (next call is token_revoked) and the master token cannot log out", async () => {
    daemon = await startTestDaemon();
    const { token } = await pairAs(daemon, "Mac");
    expect((await daemon.call("POST", "/v1/auth/logout", { apnsToken: null }, token)).json).toEqual({ ok: true });
    const after = await daemon.call("GET", "/v1/machine", undefined, token);
    expect(after.status).toBe(401);
    expect(errorResponseSchema.parse(after.json).error.code).toBe("token_revoked");
    await expectApiError(daemon, "POST", "/v1/auth/logout", 400, "invalid_request", { apnsToken: null });
  });

  it("marks the caller as current and tracks last seen and last IP", async () => {
    daemon = await startTestDaemon();
    const phone = await pairAs(daemon, "Phone");
    const laptop = await pairAs(daemon, "Laptop");
    await daemon.call("GET", "/v1/machine", undefined, laptop.token);
    const seen = await listDevices(phone.token);
    expect(seen.map((device) => [device.name, device.current, device.revoked])).toEqual([["Phone", true, false], ["Laptop", false, false]]);
    expect(seen.every((device) => device.lastIp === "127.0.0.1" && device.lastSeenAt !== null)).toBe(true);
    expect((await listDevices()).some((device) => device.current)).toBe(false);
  });
});

describe("revoke", () => {
  it("revokes one device by name, one by id, then all, and rejects unknown ones", async () => {
    daemon = await startTestDaemon();
    const [a, b, c] = [await pairAs(daemon, "Alpha"), await pairAs(daemon, "Beta"), await pairAs(daemon, "Gamma")];
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
    daemon = await startTestDaemon();
    const { token, deviceId } = await pairAs(daemon, "Phone");
    const stream = await daemon.openStream(token);
    await waitUntil(() => stream.events.length === 1);
    const closed = new Promise<number>((resolve) => stream.ws.once("close", (code: number) => { resolve(code); }));
    await daemon.call("POST", "/v1/auth/revoke", { device: deviceId });
    expect(await closed).toBe(1008);
    const body = await new Promise<string>((resolve, reject) => {
      const ws = daemon.connectStream("/v1/stream", { authorization: `Bearer ${token}` });
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

describe("wipe push", () => {
  it("sends the silent wipe push to a revoked device with an attached push token and forgets its registration", async () => {
    apnsServer = await startApnsServer();
    const apns = createTestApnsClient(apnsServer);
    daemon = await startTestDaemon({}, { apns, log: createLogger(() => undefined, () => new Date()) });
    const { token } = await pairAs(daemon, "Phone");
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
    daemon = await startTestDaemon({}, { apns });
    const { token } = await pairAs(daemon, "Phone");
    const apnsToken = "cd".repeat(32);
    await daemon.call("POST", "/v1/devices", { apnsToken, environment: "sandbox", name: "Phone", notifications: [] }, token);
    await daemon.call("POST", "/v1/auth/logout", { apnsToken }, token);
    expect(readState("devices.json")).not.toContain(apnsToken);
    expect(apnsServer.requests).toHaveLength(0);
    apns.close();
  });
});
