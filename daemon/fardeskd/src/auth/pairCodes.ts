// One-time pairing codes: held in memory (hashed), valid 10 minutes, redeemable once.
import { createHash, randomBytes } from "node:crypto";
import type { PairCodeResult } from "../contract/schema.js";

export const PAIR_CODE_BYTES = 32;
export const PAIR_CODE_TTL_MS = 10 * 60 * 1000;

export type PairCodes = {
  issue: () => PairCodeResult;
  /** True once for a valid, unexpired code; the code is spent either way when it matches. */
  redeem: (code: string) => boolean;
};

const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");

export function createPairCodes(now: () => number): PairCodes {
  const open = new Map<string, number>();
  const sweep = (): void => {
    for (const [hash, expiresAt] of open) if (expiresAt <= now()) open.delete(hash);
  };
  return {
    issue(): PairCodeResult {
      sweep();
      const code = randomBytes(PAIR_CODE_BYTES).toString("base64url");
      const expiresAt = now() + PAIR_CODE_TTL_MS;
      open.set(hashCode(code), expiresAt);
      return { code, expiresAt: new Date(expiresAt).toISOString() };
    },
    redeem(code): boolean {
      sweep();
      return open.delete(hashCode(code));
    },
  };
}
