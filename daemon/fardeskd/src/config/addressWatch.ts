// Waiting for a tailnet address and noticing when it goes away: capped exponential backoff, one log line per state change.
import { stateLabel } from "./tailscale.js";
import type { TailscaleState } from "./tailscale.js";

export type TailnetTiming = { initialMs: number; capMs: number; recheckMs: number };

export const DEFAULT_TAILNET_TIMING: TailnetTiming = { initialMs: 2000, capMs: 60_000, recheckMs: 30_000 };
const BACKOFF_FACTOR = 2;

export type AddressWatch = {
  probe: () => Promise<TailscaleState>;
  log: (line: string) => void;
  timing: TailnetTiming;
  /** Sleeps, but wakes early when the process is told to stop. */
  pause: (ms: number) => Promise<void>;
  stopped: () => boolean;
};

export function pauseUnless(stop: Promise<void>): (ms: number) => Promise<void> {
  return async (ms) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      void stop.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
}

/** Returns the tailnet address once there is one, or null when told to stop first. */
export async function waitForAddress(watch: AddressWatch): Promise<string | null> {
  let delay = watch.timing.initialMs;
  let lastLabel: string | null = null;
  while (!watch.stopped()) {
    const state = await watch.probe();
    if (state.kind === "running") {
      if (lastLabel !== null) watch.log(`tailnet address ${state.address}`);
      return state.address;
    }
    const label = stateLabel(state);
    if (label !== lastLabel) watch.log(`waiting for Tailscale: ${label}`);
    lastLabel = label;
    await watch.pause(delay);
    delay = Math.min(delay * BACKOFF_FACTOR, watch.timing.capMs);
  }
  return null;
}

/** Returns when `address` is no longer the tailnet address (one log line says how), or when told to stop. */
export async function untilAddressLost(address: string, watch: AddressWatch): Promise<void> {
  for (;;) {
    await watch.pause(watch.timing.recheckMs);
    if (watch.stopped()) return;
    const state = await watch.probe();
    if (state.kind === "running" && state.address === address) continue;
    watch.log(state.kind === "running" ? `tailnet address changed from ${address} to ${state.address}` : `tailnet address ${address} is gone: ${stateLabel(state)}`);
    return;
  }
}
