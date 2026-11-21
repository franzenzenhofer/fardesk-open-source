import { describe, expect, it } from "vitest";
import { DEFAULT_TAILNET_TIMING, pauseUnless, untilAddressLost, waitForAddress } from "./addressWatch.js";
import type { AddressWatch } from "./addressWatch.js";
import type { TailscaleState } from "./tailscale.js";

type Rig = { watch: AddressWatch; lines: string[]; pauses: number[]; stop: () => void };

function rig(answers: (call: number) => TailscaleState, timing = { initialMs: 0, capMs: 0, recheckMs: 0 }): Rig {
  const lines: string[] = [];
  const pauses: number[] = [];
  let calls = 0;
  let stopped = false;
  const watch: AddressWatch = {
    probe: async () => Promise.resolve(answers(calls++)),
    log: (line) => lines.push(line),
    timing,
    pause: async (ms) => {
      pauses.push(ms);
      return Promise.resolve();
    },
    stopped: () => stopped,
  };
  return { watch, lines, pauses, stop: (): void => { stopped = true; } };
}

const running = (address: string): TailscaleState => ({ kind: "running", address });

function stopping(stop: () => void): () => Promise<void> {
  return () => {
    stop();
    return Promise.resolve();
  };
}

describe("waitForAddress", () => {
  it("writes one waiting line and one address line for 100 failed attempts", async () => {
    const { watch, lines } = rig((call) => (call < 100 ? { kind: "unreachable" } : running("100.64.0.4")));
    expect(await waitForAddress(watch)).toBe("100.64.0.4");
    expect(lines).toEqual(["waiting for Tailscale: stopped", "tailnet address 100.64.0.4"]);
  });

  it("logs again only when the state changes", async () => {
    const states: TailscaleState[] = [{ kind: "not-installed" }, { kind: "not-installed" }, { kind: "logged-out" }, { kind: "logged-out" }, running("100.64.0.4")];
    const { watch, lines } = rig((call) => states[call] ?? running("100.64.0.4"));
    await waitForAddress(watch);
    expect(lines).toEqual(["waiting for Tailscale: not installed", "waiting for Tailscale: logged out", "tailnet address 100.64.0.4"]);
  });

  it("is silent when the address is there at once", async () => {
    const { watch, lines } = rig(() => running("100.64.0.4"));
    expect(await waitForAddress(watch)).toBe("100.64.0.4");
    expect(lines).toEqual([]);
  });

  it("doubles the pause from 2 s up to the 60 s cap", async () => {
    const { watch, pauses } = rig((call) => (call < 8 ? { kind: "stopped" } : running("100.64.0.4")), { ...DEFAULT_TAILNET_TIMING });
    await waitForAddress(watch);
    expect(pauses).toEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
  });

  it("returns null when told to stop", async () => {
    const { watch, stop } = rig(() => ({ kind: "stopped" }));
    const waiting = waitForAddress({ ...watch, pause: stopping(stop) });
    expect(await waiting).toBeNull();
  });
});

describe("untilAddressLost", () => {
  it("keeps quiet while the address stays and says what happened when it changes", async () => {
    const { watch, lines } = rig((call) => running(call < 3 ? "100.64.0.4" : "100.64.0.5"));
    await untilAddressLost("100.64.0.4", watch);
    expect(lines).toEqual(["tailnet address changed from 100.64.0.4 to 100.64.0.5"]);
  });

  it("says why when the address disappears", async () => {
    const { watch, lines } = rig((call) => (call < 2 ? running("100.64.0.4") : { kind: "stopped" }));
    await untilAddressLost("100.64.0.4", watch);
    expect(lines).toEqual(["tailnet address 100.64.0.4 is gone: stopped"]);
  });

  it("returns without a line when told to stop", async () => {
    const { watch, lines, stop } = rig(() => running("100.64.0.4"));
    await untilAddressLost("100.64.0.4", { ...watch, pause: stopping(stop) });
    expect(lines).toEqual([]);
  });
});

describe("pauseUnless", () => {
  it("wakes at once when the stop promise resolves", async () => {
    const stop = Promise.resolve();
    const started = Date.now();
    await pauseUnless(stop)(60_000);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("sleeps for the given time otherwise", async () => {
    const started = Date.now();
    await pauseUnless(new Promise<void>(() => undefined))(30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});
