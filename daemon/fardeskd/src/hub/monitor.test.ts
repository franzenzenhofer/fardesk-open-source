import { describe, expect, it } from "vitest";
import { nextStatus } from "./monitor.js";
import type { PeerStatus } from "./monitor.js";
import type { ProbeResult } from "./probe.js";

const online: PeerStatus = { online: true, lastSeen: "2026-11-16T12:00:00.000Z", latencyMs: 20, problem: null };
const timeout: ProbeResult = { online: false, timedOut: true, latencyMs: null, problem: "no answer within 5 s", machine: null };
const refused: ProbeResult = { online: false, timedOut: false, latencyMs: null, problem: "connection refused (the daemon is not running there)", machine: null };

describe("nextStatus", () => {
  it("keeps a busy peer online through one slow probe, and says so", () => {
    const status = nextStatus(online, timeout, 1);
    expect(status.online).toBe(true);
    expect(status.lastSeen).toBe(online.lastSeen);
    expect(status.problem).toBe("slow: no answer within 5 s, still trying");
  });

  it("marks it offline on the second slow probe in a row", () => {
    expect(nextStatus(online, timeout, 2)).toEqual({ online: false, lastSeen: online.lastSeen, latencyMs: null, problem: "no answer within 5 s" });
  });

  it("marks a refused connection offline at once, and never revives an offline peer on a timeout", () => {
    expect(nextStatus(online, refused, 0).online).toBe(false);
    expect(nextStatus({ ...online, online: false }, timeout, 1).online).toBe(false);
  });
});
