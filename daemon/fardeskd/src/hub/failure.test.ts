import { describe, expect, it } from "vitest";
import { NOT_REACHABLE, NO_ANSWER_IN_TIME, SERVICE_NOT_RUNNING, describeFailure } from "./failure.js";

const connectError = (code: string): Error => new Error("fetch failed", { cause: { code } });

describe("describeFailure", () => {
  it("says the service is not running when the computer answers but nothing listens", () => {
    expect(describeFailure(connectError("ECONNREFUSED"), 5000)).toEqual({ problem: SERVICE_NOT_RUNNING, detail: "connection refused (ECONNREFUSED)" });
  });

  it("says the computer is not reachable over Tailscale for every other connect error", () => {
    for (const code of ["EHOSTUNREACH", "ENETUNREACH", "ECONNRESET", "ETIMEDOUT"]) {
      expect(describeFailure(connectError(code), 5000)).toEqual({ problem: NOT_REACHABLE, detail: `cannot connect (${code})` });
    }
  });

  it("says the computer did not answer in time on a timeout and keeps the seconds in the detail", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(describeFailure(timeout, 5000)).toEqual({ problem: NO_ANSWER_IN_TIME, detail: "no answer within 5 s" });
  });

  it("keeps the plain sentence for an error without a code and the message as detail", () => {
    expect(describeFailure(new Error("boom"), 5000)).toEqual({ problem: NOT_REACHABLE, detail: "boom" });
    expect(describeFailure("weird", 5000)).toEqual({ problem: NOT_REACHABLE, detail: "request failed" });
  });
});
