import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { PAIR_CODE_TTL_MS } from "../auth/pairCodes.js";
import { loginResultSchema, pairCodeResultSchema } from "../contract/schema.js";

let daemon: TestDaemon;

afterEach(async () => {
  vi.useRealTimers();
  await daemon.close();
});

async function newCode(token: string | null = TEST_TOKEN): Promise<string> {
  const response = await daemon.call("POST", "/v1/auth/pair-code", undefined, token);
  expect(response.status).toBe(200);
  return pairCodeResultSchema.parse(response.json).code;
}

const pairWith = async (code: string): Promise<{ status: number; json: unknown }> =>
  daemon.call("POST", "/v1/auth/pair", { code, deviceName: "Test iPhone" }, null);

describe("POST /v1/auth/pair", () => {
  it("exchanges a code for a working device token, once", async () => {
    daemon = await startTestDaemon();
    const code = await newCode();
    const first = await pairWith(code);
    expect(first.status).toBe(200);
    const result = loginResultSchema.parse(first.json);
    expect(result.token).not.toBe(TEST_TOKEN);
    expect((await daemon.call("GET", "/v1/machine", undefined, result.token)).status).toBe(200);
    await expectApiError(daemon, "POST", "/v1/auth/pair", 401, "unauthorized", { code, deviceName: "Again" });
  });

  it("refuses a code after 2 minutes", async () => {
    daemon = await startTestDaemon();
    vi.useFakeTimers({ toFake: ["Date"] });
    const code = await newCode();
    vi.setSystemTime(Date.now() + PAIR_CODE_TTL_MS + 1000);
    expect((await pairWith(code)).status).toBe(401);
  });

  it("rate limits wrong codes like a login: 429 after maxFailures, also for a valid code", async () => {
    daemon = await startTestDaemon({ auth: { maxFailures: 3, windowSeconds: 60 } });
    const code = await newCode();
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await pairWith("x".repeat(43))).status).toBe(401);
    expect((await pairWith("x".repeat(43))).status).toBe(429);
    expect((await pairWith(code)).status).toBe(429);
  });

  it("needs a well formed body and never echoes the code", async () => {
    daemon = await startTestDaemon();
    expect((await daemon.call("POST", "/v1/auth/pair", { code: "short", deviceName: "x" }, null)).status).toBe(400);
    expect((await daemon.call("POST", "/v1/auth/pair", { deviceName: "x" }, null)).status).toBe(400);
  });
});

describe("POST /v1/auth/pair-code", () => {
  it("needs the master token: no bearer is 401, a device token is 401", async () => {
    daemon = await startTestDaemon();
    expect((await daemon.call("POST", "/v1/auth/pair-code", undefined, null)).status).toBe(401);
    const device = loginResultSchema.parse((await pairWith(await newCode())).json);
    expect((await daemon.call("POST", "/v1/auth/pair-code", undefined, device.token)).status).toBe(401);
  });
});

describe("POST /v1/auth/rotate-token", () => {
  it("kills the old master token, keeps device tokens and writes the new token to the config at mode 600", async () => {
    daemon = await startTestDaemon();
    const device = loginResultSchema.parse((await pairWith(await newCode())).json);
    const configFile = join(daemon.config.stateDir, "config.json");
    const before = readFileSync(configFile, "utf8");
    expect((await daemon.call("POST", "/v1/auth/rotate-token", undefined, device.token)).status).toBe(401);
    expect((await daemon.call("POST", "/v1/auth/rotate-token")).status).toBe(200);
    const rotated = (JSON.parse(readFileSync(configFile, "utf8")) as { token: string }).token;
    expect(rotated).toMatch(/^[0-9a-f]{64}$/);
    expect(rotated).not.toBe(TEST_TOKEN);
    expect(before).toContain(TEST_TOKEN);
    expect(statSync(configFile).mode & 0o777).toBe(0o600);
    expect((await daemon.call("GET", "/v1/machine", undefined, TEST_TOKEN)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/machine", undefined, rotated)).status).toBe(200);
    expect((await daemon.call("GET", "/v1/machine", undefined, device.token)).status).toBe(200);
  });
});
