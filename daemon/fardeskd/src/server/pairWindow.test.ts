// The pairing window rules (#67) against a real daemon: 2 minutes, one open code, only while `fardeskd pair` holds
// it, five wrong codes lock it and write an audit line.
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { readAudit } from "../audit/store.js";
import { PAIR_CODE_TTL_MS, PAIR_HEARTBEAT_LEASE_MS, PAIR_MAX_WRONG, pairWindowStatusSchema, windowIdOf } from "../auth/pairCodes.js";
import type { PairWindowStatus } from "../auth/pairCodes.js";
import { loginResultSchema, pairCodeResultSchema } from "../contract/schema.js";

let daemon: TestDaemon;
const WRONG = "x".repeat(43);

afterEach(async () => {
  vi.useRealTimers();
  await daemon.close();
});

async function openWindow(): Promise<{ code: string; id: string }> {
  const response = await daemon.call("POST", "/v1/auth/pair-code", undefined, TEST_TOKEN);
  expect(response.status).toBe(200);
  const { code } = pairCodeResultSchema.parse(response.json);
  return { code, id: windowIdOf(code) };
}

const pairWith = async (code: string): Promise<{ status: number; json: unknown }> =>
  daemon.call("POST", "/v1/auth/pair", { code, deviceName: "Test iPhone" }, null);

async function statusOf(id: string): Promise<PairWindowStatus> {
  const response = await daemon.call("GET", `/v1/auth/pair-window?window=${id}`, undefined, TEST_TOKEN);
  expect(response.status).toBe(200);
  return pairWindowStatusSchema.parse(response.json);
}

describe("pairing window", () => {
  it("accepts a code that is polled until just inside the 2 minutes and refuses it after", async () => {
    daemon = await startTestDaemon();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { code, id } = await openWindow();
    const start = Date.now();
    for (let elapsed = PAIR_HEARTBEAT_LEASE_MS - 1000; elapsed < PAIR_CODE_TTL_MS - 1000; elapsed += PAIR_HEARTBEAT_LEASE_MS - 1000) {
      vi.setSystemTime(start + elapsed);
      expect((await statusOf(id)).state).toBe("open");
    }
    vi.setSystemTime(start + PAIR_CODE_TTL_MS - 500);
    expect((await pairWith(code)).status).toBe(200);
    const later = await openWindow();
    vi.setSystemTime(start + PAIR_CODE_TTL_MS * 2);
    expect((await statusOf(later.id)).state).toBe("expired");
    expect((await pairWith(later.code)).status).toBe(401);
  });

  it("refuses a pairing when nobody polls the window (the command that held it ended)", async () => {
    daemon = await startTestDaemon();
    vi.useFakeTimers({ toFake: ["Date"] });
    const { code, id } = await openWindow();
    vi.setSystemTime(Date.now() + PAIR_HEARTBEAT_LEASE_MS + 1000);
    const message = await expectApiError(daemon, "POST", "/v1/auth/pair", 401, "unauthorized", { code, deviceName: "Late" });
    expect(message).toContain("no pairing window is open");
    expect((await statusOf(id)).state).toBe("abandoned");
  });

  it("refuses a redeem when no window was ever opened", async () => {
    daemon = await startTestDaemon();
    const message = await expectApiError(daemon, "POST", "/v1/auth/pair", 401, "unauthorized", { code: WRONG, deviceName: "Early" });
    expect(message).toContain("fardeskd pair");
  });

  it("cancels the open code when a new window is opened", async () => {
    daemon = await startTestDaemon();
    const first = await openWindow();
    const second = await openWindow();
    expect((await statusOf(first.id)).state).toBe("cancelled");
    expect((await pairWith(first.code)).status).toBe(401);
    expect((await pairWith(second.code)).status).toBe(200);
  });

  it("closes the window on request, at once", async () => {
    daemon = await startTestDaemon();
    const { code, id } = await openWindow();
    expect((await daemon.call("POST", `/v1/auth/pair-window/close?window=${id}`, undefined, TEST_TOKEN)).status).toBe(200);
    expect((await statusOf(id)).state).toBe("closed");
    expect((await pairWith(code)).status).toBe(401);
  });

  it("locks after five wrong codes: audit line, then even the right code fails", async () => {
    daemon = await startTestDaemon({ auth: { maxFailures: 50, windowSeconds: 60 } });
    const { code, id } = await openWindow();
    for (let attempt = 1; attempt < PAIR_MAX_WRONG; attempt += 1) expect((await pairWith(WRONG)).status).toBe(401);
    const fifth = await pairWith(WRONG);
    expect(fifth.status).toBe(429);
    expect((await statusOf(id)).state).toBe("locked");
    await waitUntil(() => readAudit(daemon.config.stateDir, null).some((line) => line.event === "pairing_locked"));
    const locked = readAudit(daemon.config.stateDir, null).filter((line) => line.event === "pairing_locked");
    expect(locked).toHaveLength(1);
    expect(locked[0]).toMatchObject({ deviceId: null, method: "POST", route: "/v1/auth/pair", result: 429 });
    expect(JSON.stringify(locked)).not.toContain(code);
    const sixth = await pairWith(WRONG);
    expect(sixth.status).toBe(401);
    expect((await pairWith(code)).status).toBe(401);
  });

  it("reports who paired, then the window is closed", async () => {
    daemon = await startTestDaemon();
    const { code, id } = await openWindow();
    const login = loginResultSchema.parse((await pairWith(code)).json);
    const status = await statusOf(id);
    expect(status.state).toBe("paired");
    expect(status.paired).toEqual({ deviceName: "Test iPhone", deviceId: login.deviceId, tailnetDevice: null });
    expect((await pairWith(code)).status).toBe(401);
  });

  it("is for the master token only, and the window id must be a SHA-256 hex", async () => {
    daemon = await startTestDaemon();
    const { code, id } = await openWindow();
    expect((await daemon.call("GET", `/v1/auth/pair-window?window=${id}`, undefined, null)).status).toBe(401);
    expect((await daemon.call("POST", `/v1/auth/pair-window/close?window=${id}`, undefined, null)).status).toBe(401);
    const device = loginResultSchema.parse((await pairWith(code)).json);
    expect((await daemon.call("GET", `/v1/auth/pair-window?window=${id}`, undefined, device.token)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/auth/pair-window?window=abc", undefined, TEST_TOKEN)).status).toBe(400);
    expect((await daemon.call("GET", "/v1/auth/pair-window", undefined, TEST_TOKEN)).status).toBe(400);
  });
});
