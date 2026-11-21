// The pairing window: one open code at a time, valid 2 minutes, held open by `fardeskd pair` (it polls; no poll for
// 10 seconds closes the window), closed by 5 wrong codes, by the first success or when the command ends.
// The code exists only as a SHA-256 hash in memory and is compared in constant time.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { PairCodeResult } from "../contract/schema.js";

export const PAIR_CODE_BYTES = 32;
export const PAIR_CODE_TTL_MS = 2 * 60 * 1000;
export const PAIR_MAX_WRONG = 5;
export const PAIR_HEARTBEAT_LEASE_MS = 10_000;

export const pairedDeviceSchema = z.strictObject({
  deviceName: z.string().min(1),
  deviceId: z.string().min(1),
  /** The caller's tailnet device name; null when the request came from this computer itself. */
  tailnetDevice: z.string().min(1).nullable(),
});
export type PairedDevice = z.infer<typeof pairedDeviceSchema>;

export const pairWindowStatusSchema = z.strictObject({
  /** `cancelled`: a newer window replaced this one; `none`: this daemon never opened it. */
  state: z.enum(["open", "paired", "locked", "expired", "abandoned", "closed", "cancelled", "none"]),
  expiresAt: z.iso.datetime().nullable(),
  paired: pairedDeviceSchema.nullable(),
});
export type PairWindowStatus = z.infer<typeof pairWindowStatusSchema>;

/** `locked`: this wrong code was the last one allowed, the window is now closed. */
export type RedeemResult = "ok" | "no_window" | "wrong" | "locked";

export type PairWindow = {
  /** Opens a window with a fresh code; the window that was open is cancelled. */
  open: () => PairCodeResult;
  redeem: (code: string) => RedeemResult;
  /** `redeem` already closed the window on success; this records which device paired. */
  paired: (device: PairedDevice) => void;
  /** Where the window stands now; asking while it is open keeps it open (the heartbeat of `fardeskd pair`). */
  status: (windowId: string) => PairWindowStatus;
  close: (windowId: string) => void;
};

type Ended = "paired" | "locked" | "closed";
type Current = { id: string; hash: Buffer; expiresAt: number; lastBeat: number; wrong: number; ended: Ended | null; device: PairedDevice | null };

const digest = (code: string): Buffer => createHash("sha256").update(code).digest();

/** The id of a window: the hex SHA-256 of its code, which the command that holds the code can compute and nobody else. */
export const windowIdOf = (code: string): string => digest(code).toString("hex");

function stateOf(window: Current, now: number): PairWindowStatus["state"] {
  if (window.ended !== null) return window.ended;
  if (now >= window.expiresAt) return "expired";
  return now - window.lastBeat > PAIR_HEARTBEAT_LEASE_MS ? "abandoned" : "open";
}

/** Judges one code against an open window: a match ends it, the last allowed wrong code locks it. */
function judge(window: Current, code: string): RedeemResult {
  if (timingSafeEqual(window.hash, digest(code))) {
    window.ended = "paired";
    return "ok";
  }
  window.wrong += 1;
  if (window.wrong < PAIR_MAX_WRONG) return "wrong";
  window.ended = "locked";
  return "locked";
}

function newWindow(code: string, now: number): Current {
  return { id: windowIdOf(code), hash: digest(code), expiresAt: now + PAIR_CODE_TTL_MS, lastBeat: now, wrong: 0, ended: null, device: null };
}

export function createPairWindow(now: () => number): PairWindow {
  let current: Current | null = null;
  let replaced: string | null = null;
  return {
    open(): PairCodeResult {
      if (current !== null) replaced = current.id;
      const code = randomBytes(PAIR_CODE_BYTES).toString("base64url");
      current = newWindow(code, now());
      return { code, expiresAt: new Date(current.expiresAt).toISOString() };
    },
    redeem(code): RedeemResult {
      if (current === null || stateOf(current, now()) !== "open") return "no_window";
      return judge(current, code);
    },
    paired(device): void {
      if (current?.ended === "paired") current.device = device;
    },
    status(windowId): PairWindowStatus {
      if (current === null || current.id !== windowId) return { state: windowId === replaced ? "cancelled" : "none", expiresAt: null, paired: null };
      const state = stateOf(current, now());
      if (state === "open") current.lastBeat = now();
      return { state, expiresAt: new Date(current.expiresAt).toISOString(), paired: current.device };
    },
    close(windowId): void {
      if (current !== null && current.id === windowId && current.ended === null) current.ended = "closed";
    },
  };
}
