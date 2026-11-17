// Sliding-window limiter for password attempts: per source IP, plus a global cap against rotating IPs.
import { FardeskError } from "../core/errors.js";

export const GLOBAL_CAP_FACTOR = 10;

export type LoginLimiterOptions = { maxFailures: number; windowMs: number; now: () => number };

export type LoginLimiter = {
  /** Throws `rate_limited` when this IP (or everybody together) has used up its failures. */
  check: (ip: string) => void;
  recordFailure: (ip: string) => void;
  recordSuccess: (ip: string) => void;
};

export function createLoginLimiter({ maxFailures, windowMs, now }: LoginLimiterOptions): LoginLimiter {
  const byIp = new Map<string, number[]>();
  let all: number[] = [];

  const recent = (times: number[]): number[] => {
    const cutoff = now() - windowMs;
    return times.filter((time) => time > cutoff);
  };

  return {
    check(ip): void {
      all = recent(all);
      const own = recent(byIp.get(ip) ?? []);
      byIp.set(ip, own);
      if (own.length >= maxFailures || all.length >= maxFailures * GLOBAL_CAP_FACTOR) {
        throw new FardeskError("rate_limited", "too many failed attempts, try again later");
      }
    },
    recordFailure(ip): void {
      const time = now();
      byIp.set(ip, [...recent(byIp.get(ip) ?? []), time]);
      all = [...recent(all), time];
    },
    recordSuccess(ip): void {
      byIp.delete(ip);
    },
  };
}
