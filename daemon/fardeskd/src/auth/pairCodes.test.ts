import { describe, expect, it } from "vitest";
import { PAIR_CODE_TTL_MS, PAIR_HEARTBEAT_LEASE_MS, PAIR_MAX_WRONG, createPairWindow, windowIdOf } from "./pairCodes.js";

const WRONG = "x".repeat(43);
const DEVICE = { deviceName: "Test iPhone", deviceId: "dev-1", tailnetDevice: "phone" };

function windowWithClock(): { window: ReturnType<typeof createPairWindow>; advance: (ms: number) => void } {
  let now = 1_000;
  return {
    window: createPairWindow(() => now),
    advance(ms): void {
      now += ms;
    },
  };
}

describe("pairing window", () => {
  it("issues a 43 character base64url code valid for 2 minutes", () => {
    const { window } = windowWithClock();
    const { code, expiresAt } = window.open();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(new Date(1_000 + PAIR_CODE_TTL_MS).toISOString());
    expect(PAIR_CODE_TTL_MS).toBe(120_000);
  });

  it("works once and fails the second time", () => {
    const { window } = windowWithClock();
    const { code } = window.open();
    expect(window.redeem(code)).toBe("ok");
    expect(window.redeem(code)).toBe("no_window");
  });

  it("refuses a code after 2 minutes and accepts it just before", () => {
    const { window, advance } = windowWithClock();
    const { code } = window.open();
    const id = windowIdOf(code);
    for (let beat = 0; beat < 11; beat += 1) {
      advance(PAIR_HEARTBEAT_LEASE_MS - 1);
      window.status(id);
    }
    expect(window.redeem(code)).toBe("ok");
    const late = window.open();
    advance(PAIR_CODE_TTL_MS);
    expect(window.redeem(late.code)).toBe("no_window");
    expect(window.status(windowIdOf(late.code)).state).toBe("expired");
  });

  it("opening a new window cancels the open code", () => {
    const { window } = windowWithClock();
    const first = window.open();
    const second = window.open();
    expect(window.redeem(first.code)).toBe("wrong");
    expect(window.status(windowIdOf(first.code)).state).toBe("cancelled");
    expect(window.redeem(second.code)).toBe("ok");
  });

  it("refuses to redeem when no window was ever opened", () => {
    const { window } = windowWithClock();
    expect(window.redeem(WRONG)).toBe("no_window");
    expect(window.status(windowIdOf(WRONG)).state).toBe("none");
  });

  it("closes after five wrong codes, even for the right code that follows", () => {
    const { window } = windowWithClock();
    const { code } = window.open();
    const results = Array.from({ length: PAIR_MAX_WRONG }, () => window.redeem(WRONG));
    expect(results).toEqual(["wrong", "wrong", "wrong", "wrong", "locked"]);
    expect(window.redeem(WRONG)).toBe("no_window");
    expect(window.redeem(code)).toBe("no_window");
    expect(window.status(windowIdOf(code)).state).toBe("locked");
  });

  it("four wrong codes leave the window open for the right one", () => {
    const { window } = windowWithClock();
    const { code } = window.open();
    for (let attempt = 0; attempt < PAIR_MAX_WRONG - 1; attempt += 1) expect(window.redeem(WRONG)).toBe("wrong");
    expect(window.redeem(code)).toBe("ok");
  });

  it("a code of another length is wrong, not an error (compared as SHA-256 digests)", () => {
    const { window } = windowWithClock();
    window.open();
    expect(window.redeem("")).toBe("wrong");
    expect(window.redeem("y".repeat(10_000))).toBe("wrong");
  });

  it("closes when the command that holds it stops asking", () => {
    const { window, advance } = windowWithClock();
    const { code } = window.open();
    const id = windowIdOf(code);
    advance(PAIR_HEARTBEAT_LEASE_MS - 1);
    expect(window.status(id).state).toBe("open");
    advance(PAIR_HEARTBEAT_LEASE_MS - 1);
    expect(window.status(id).state).toBe("open");
    advance(PAIR_HEARTBEAT_LEASE_MS + 1);
    expect(window.redeem(code)).toBe("no_window");
    expect(window.status(id).state).toBe("abandoned");
  });

  it("closes on request and reports who paired", () => {
    const { window } = windowWithClock();
    const closed = window.open();
    window.close(windowIdOf(closed.code));
    expect(window.redeem(closed.code)).toBe("no_window");
    expect(window.status(windowIdOf(closed.code)).state).toBe("closed");
    const next = window.open();
    expect(window.redeem(next.code)).toBe("ok");
    window.paired(DEVICE);
    expect(window.status(windowIdOf(next.code))).toMatchObject({ state: "paired", paired: DEVICE });
  });

  it("closing with another window's id changes nothing", () => {
    const { window } = windowWithClock();
    const { code } = window.open();
    window.close(windowIdOf(WRONG));
    expect(window.redeem(code)).toBe("ok");
  });
});
