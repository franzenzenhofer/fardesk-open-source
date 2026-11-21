// Pairing and login from a non-local address: the daemon listens on every interface and the test calls it through this
// computer's own network address, so the caller is not loopback and Tailscale (a real fake executable) is asked.
import { readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_PASSWORD, authOverrides } from "../../test/support/auth.js";
import { SELF_ADDRESS, createFakeTailscale } from "../../test/support/fakeTailscale.js";
import type { FakeTailscale } from "../../test/support/fakeTailscale.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { UNAUTHENTICATED_AUDIT_FILE, auditEntrySchema } from "../audit/store.js";
import { PAIRING_REFUSED_MESSAGE, PAIRING_UNVERIFIED_MESSAGE } from "../auth/tailnetCaller.js";
import { loginResultSchema, pairCodeResultSchema } from "../contract/schema.js";

const TAILNET = "example.ts.net";

function ownNetworkAddress(): string | null {
  const all = Object.values(networkInterfaces()).flatMap((list) => list ?? []);
  return all.find((entry) => entry.family === "IPv4" && !entry.internal)?.address ?? null;
}

const address = ownNetworkAddress();
let daemon: TestDaemon;
let tailscale: FakeTailscale;

afterEach(async () => {
  await daemon.close();
});

async function start(overrides: Record<string, unknown> = {}): Promise<void> {
  tailscale = createFakeTailscale(SELF_ADDRESS);
  tailscale.setDevice(SELF_ADDRESS, { name: `studio.${TAILNET}.`, login: "owner@example.com" });
  daemon = await startTestDaemon({ ...(await authOverrides()), ...overrides }, { tailscaleCommands: [tailscale.binary] }, { address: "0.0.0.0" });
}

async function pairFromNetwork(): Promise<{ status: number; json: unknown }> {
  const code = pairCodeResultSchema.parse((await daemon.call("POST", "/v1/auth/pair-code", undefined, TEST_TOKEN)).json).code;
  const url = `http://${address}:${daemon.config.bind.port}/v1/auth/pair`;
  const response = await fetch(url, { method: "POST", body: JSON.stringify({ code, deviceName: "Test iPhone" }) });
  return { status: response.status, json: await response.json() };
}

async function loginFromNetwork(): Promise<{ status: number; json: unknown }> {
  const url = `http://${address}:${daemon.config.bind.port}/v1/auth/login`;
  const response = await fetch(url, { method: "POST", body: JSON.stringify({ password: TEST_PASSWORD, deviceName: "Test iPhone" }) });
  return { status: response.status, json: await response.json() };
}

const refusalAudit = (): ReturnType<typeof auditEntrySchema.parse>[] =>
  readFileSync(join(daemon.config.stateDir, UNAUTHENTICATED_AUDIT_FILE), "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => auditEntrySchema.parse(JSON.parse(line)));

describe.skipIf(address === null)("POST /v1/auth/pair from another address", () => {
  it("pairs a device of the same tailnet user", async () => {
    await start();
    tailscale.setDevice(address ?? "", { name: `phone.${TAILNET}.`, login: "owner@example.com" });
    const result = await pairFromNetwork();
    expect(result.status).toBe(200);
    expect(loginResultSchema.parse(result.json).token).not.toBe(TEST_TOKEN);
  });

  it("answers 403 with a fixed text and writes one audit line with the device name", async () => {
    await start();
    tailscale.setDevice(address ?? "", { name: `laptop.${TAILNET}.`, login: "guest@example.com" });
    const result = await pairFromNetwork();
    expect(result).toEqual({ status: 403, json: { error: { code: "forbidden", message: PAIRING_REFUSED_MESSAGE } } });
    const lines = refusalAudit();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "login_failed", route: "/v1/auth/pair", result: 403, peer: "laptop", deviceId: null });
  });

  it("pairs a user the config allows by name", async () => {
    await start({ pairing: { allowedUsers: ["guest@example.com"] } });
    tailscale.setDevice(address ?? "", { name: `laptop.${TAILNET}.`, login: "guest@example.com" });
    expect((await pairFromNetwork()).status).toBe(200);
  });

  it("logs in a device of the same tailnet user with the right password", async () => {
    await start();
    tailscale.setDevice(address ?? "", { name: `phone.${TAILNET}.`, login: "owner@example.com" });
    const result = await loginFromNetwork();
    expect(result.status).toBe(200);
    expect(loginResultSchema.parse(result.json).token).not.toBe(TEST_TOKEN);
  });

  it("refuses login from another user's device even with the right password, with one audit line", async () => {
    await start();
    tailscale.setDevice(address ?? "", { name: `laptop.${TAILNET}.`, login: "guest@example.com" });
    const result = await loginFromNetwork();
    expect(result).toEqual({ status: 403, json: { error: { code: "forbidden", message: PAIRING_REFUSED_MESSAGE } } });
    const lines = refusalAudit();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ event: "login_failed", route: "/v1/auth/login", result: 403, peer: "laptop", deviceId: null });
  });

  it("refuses when whois fails", async () => {
    await start();
    const result = await pairFromNetwork();
    expect(result).toEqual({ status: 403, json: { error: { code: "forbidden", message: PAIRING_UNVERIFIED_MESSAGE } } });
    expect(refusalAudit()).toHaveLength(1);
  });
});
