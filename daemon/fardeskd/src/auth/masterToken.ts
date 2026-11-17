// The master token (config.token) as the daemon holds it: comparable in constant time, replaceable without a restart.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MASTER_TOKEN_BYTES = 32;

export type MasterToken = {
  matches: (presented: string) => boolean;
  /** Makes this token the master token. */
  replace: (token: string) => void;
};

const digest = (value: string): Buffer => createHash("sha256").update(value).digest();

export function newMasterToken(): string {
  return randomBytes(MASTER_TOKEN_BYTES).toString("hex");
}

export function createMasterToken(initial: string): MasterToken {
  let current = digest(initial);
  return {
    matches: (presented) => presented !== "" && timingSafeEqual(digest(presented), current),
    replace(token): void {
      current = digest(token);
    },
  };
}
