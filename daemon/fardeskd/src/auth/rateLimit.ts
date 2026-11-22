// Sliding-window limiter for failed pairing attempts: per source IP, plus a global cap against rotating IPs.
import { FardeskError } from "../core/errors.js";

export const GLOBAL_CAP_FACTOR = 10;
const MAX_PENDING_CHECKS = 4;
const limited = (): FardeskError => new FardeskError("rate_limited", "too many failed attempts, try again later");

export type AttemptLimiterOptions = { maxFailures: number; windowMs: number; now: () => number };

export type AttemptLimiter = {
  /** Throws `rate_limited` when this IP (or everybody together) has used up its failures. */
  check: (ip: string) => void;
  reserve: (ip: string) => () => void;
  recordFailure: (ip: string) => void;
  recordSuccess: (ip: string) => void;
};

export function createAttemptLimiter({ maxFailures, windowMs, now }: AttemptLimiterOptions): AttemptLimiter {
  let failures: { ip: string; time: number }[] = [];
  const pending = new Map<string, number>();
  let pendingCount = 0;
  function check(ip: string): void {
    const cutoff = now() - windowMs;
    failures = failures.filter((attempt) => attempt.time > cutoff);
    const own = failures.filter((attempt) => attempt.ip === ip).length + (pending.get(ip) ?? 0);
    if (own >= maxFailures || failures.length + pendingCount >= maxFailures * GLOBAL_CAP_FACTOR) throw limited();
  }
  return {
    check,
    reserve(ip): () => void {
      check(ip);
      if (pendingCount >= MAX_PENDING_CHECKS) throw new FardeskError("rate_limited", "too many authentication requests in progress");
      pendingCount += 1;
      pending.set(ip, (pending.get(ip) ?? 0) + 1);
      return (): void => {
        const count = pending.get(ip) ?? 0;
        if (count === 1) pending.delete(ip);
        else pending.set(ip, count - 1);
        pendingCount -= 1;
      };
    },
    recordFailure(ip): void { failures.push({ ip, time: now() }); },
    recordSuccess(ip): void {
      // Keep failures in the global budget while clearing this IP's budget.
      failures = failures.map((attempt) => attempt.ip === ip ? { ...attempt, ip: "" } : attempt);
    },
  };
}
