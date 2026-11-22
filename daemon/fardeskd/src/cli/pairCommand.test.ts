// `fardeskd pair` against a real daemon: it holds the window open, reports who paired, and closes the window on exit.
import { afterEach, describe, expect, it } from "vitest";
import { PAIR_MAX_WRONG, WRONG_PAIR_CODE as WRONG, captureIo, runPairCli, startTestDaemon, waitUntil, writeConfigFile } from "../../test/support/pairCli.js";
import type { CapturedIo, TestDaemon } from "../../test/support/pairCli.js";

const LINK_PREFIX = "fardesk://pair?d=";
let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

type Running = { io: CapturedIo; done: Promise<number>; code: () => string };

async function startPair(overrides: Record<string, unknown> = {}): Promise<Running> {
  daemon = await startTestDaemon(overrides);
  const io = captureIo();
  const done = runPairCli(["--config", writeConfigFile(daemon.config)], io);
  await waitUntil(() => io.out.some((line) => line.startsWith(LINK_PREFIX)));
  const code = (): string => {
    const link = io.out.find((line) => line.startsWith(LINK_PREFIX)) ?? "";
    const payload = JSON.parse(Buffer.from(link.slice(LINK_PREFIX.length), "base64url").toString("utf8")) as Record<string, unknown>;
    expect(payload).toMatchObject({ v: 4, name: "test-mac", url: daemon.url, hub: false });
    expect(payload).not.toHaveProperty("token");
    return payload["code"] as string;
  };
  return { io, done, code };
}

const pairWith = async (code: string, deviceName = "Test iPhone"): Promise<number> =>
  (await daemon.call("POST", "/v1/auth/pair", { code, deviceName }, null)).status;

describe("fardeskd pair", () => {
  it("prints the link and QR code, stays open, then reports the device and the revoke command", async () => {
    const { io, done, code } = await startPair();
    const pairingCode = code();
    expect(io.out.join("\n")).not.toContain(daemon.config.token);
    expect(io.out.join("\n")).not.toMatch(/[0-9a-f]{64}/);
    expect(io.out.some((line) => line.split("\n").length > 10)).toBe(true);
    expect(io.out.join("\n")).toContain("2 minutes");
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(io.out.some((line) => line.startsWith("paired:"))).toBe(false);
    expect(await pairWith(pairingCode)).toBe(200);
    expect(await done).toBe(0);
    const text = io.out.join("\n");
    expect(text).toContain("paired: Test iPhone, from this computer");
    const deviceId = /device id: (\S+)/.exec(text)?.[1] ?? "";
    expect(deviceId).not.toBe("");
    expect(text).toContain(`to revoke it: fardeskd revoke ${deviceId} --config `);
    expect(await pairWith(pairingCode)).toBe(401);
  });

  it("closes the window when it is stopped, exits non-zero and pairing then fails", async () => {
    const { io, done, code } = await startPair();
    const pairingCode = code();
    io.stop();
    expect(await done).toBe(1);
    expect(io.err.join("\n")).toContain("pairing window closed");
    expect(await pairWith(pairingCode)).toBe(401);
  });

  it("exits non-zero after five wrong codes and says so", async () => {
    const { io, done, code } = await startPair({ auth: { maxFailures: 50, windowSeconds: 60 } });
    const pairingCode = code();
    for (let attempt = 0; attempt < PAIR_MAX_WRONG; attempt += 1) expect(await pairWith(WRONG)).toBeGreaterThanOrEqual(401);
    expect(await done).toBe(1);
    expect(io.err.join("\n")).toContain(`${PAIR_MAX_WRONG} wrong codes`);
    expect(io.err.join("\n")).toContain("audit line");
    expect(await pairWith(pairingCode)).toBe(401);
  });

  it("a second fardeskd pair replaces the first window, which then ends non-zero", async () => {
    const first = await startPair();
    const oldCode = first.code();
    const second = captureIo();
    const secondDone = runPairCli(["--config", writeConfigFile(daemon.config)], second);
    expect(await first.done).toBe(1);
    expect(first.io.err.join("\n")).toContain("replaced");
    expect(await pairWith(oldCode)).toBe(401);
    second.stop();
    expect(await secondDone).toBe(1);
  });
});
