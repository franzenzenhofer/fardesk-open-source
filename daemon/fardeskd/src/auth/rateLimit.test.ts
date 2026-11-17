import { describe, expect, it } from "vitest";
import { createLoginLimiter } from "./rateLimit.js";

function setup(maxFailures = 3): { clock: { now: number }; limiter: ReturnType<typeof createLoginLimiter> } {
  const clock = { now: 1_000_000 };
  return { clock, limiter: createLoginLimiter({ maxFailures, windowMs: 60_000, now: () => clock.now }) };
}

const expectLimited = (fn: () => void): void => {
  expect(fn).toThrow(expect.objectContaining({ code: "rate_limited" }));
};

describe("per-IP window", () => {
  it("blocks an IP after maxFailures failures and lets others through", () => {
    const { limiter } = setup();
    for (let index = 0; index < 3; index += 1) {
      limiter.check("1.1.1.1");
      limiter.recordFailure("1.1.1.1");
    }
    expectLimited(() => { limiter.check("1.1.1.1"); });
    limiter.check("2.2.2.2");
  });

  it("recovers once the failures leave the window", () => {
    const { clock, limiter } = setup();
    for (let index = 0; index < 3; index += 1) limiter.recordFailure("1.1.1.1");
    expectLimited(() => { limiter.check("1.1.1.1"); });
    clock.now += 60_001;
    limiter.check("1.1.1.1");
  });

  it("clears the IP on success", () => {
    const { limiter } = setup();
    for (let index = 0; index < 2; index += 1) limiter.recordFailure("1.1.1.1");
    limiter.recordSuccess("1.1.1.1");
    limiter.recordFailure("1.1.1.1");
    limiter.check("1.1.1.1");
  });
});

describe("global cap", () => {
  it("blocks every IP once 10x maxFailures failures happened across rotating IPs", () => {
    const { limiter } = setup(2);
    for (let index = 0; index < 20; index += 1) limiter.recordFailure(`10.0.0.${index}`);
    expectLimited(() => { limiter.check("9.9.9.9"); });
  });
});
