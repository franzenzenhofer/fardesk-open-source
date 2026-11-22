import { describe, expect, it } from "vitest";
import { NO_ANSWER_IN_TIME, SERVICE_NOT_RUNNING, SLOW_ANSWER } from "./failure.js";
import { createLogger } from "../core/log.js";
import { createPeerCache } from "./cache.js";
import { ingest, nextStatus } from "./monitor.js";
import type { PeerStatus } from "./monitor.js";
import type { ProbeResult } from "./probe.js";

const online: PeerStatus = { online: true, lastSeen: "2026-11-16T12:00:00.000Z", latencyMs: 20, problem: null, detail: null };
const timeout: ProbeResult = { online: false, timedOut: true, latencyMs: null, problem: NO_ANSWER_IN_TIME, detail: "no answer within 5 s", machine: null };
const refused: ProbeResult = { online: false, timedOut: false, latencyMs: null, problem: SERVICE_NOT_RUNNING, detail: "connection refused (ECONNREFUSED)", machine: null };

describe("nextStatus", () => {
  it("keeps a busy peer online through one slow probe, and says so", () => {
    const status = nextStatus(online, timeout, 1);
    expect(status.online).toBe(true);
    expect(status.lastSeen).toBe(online.lastSeen);
    expect(status).toMatchObject({ problem: SLOW_ANSWER, detail: "no answer within 5 s" });
  });

  it("marks it offline on the second slow probe in a row", () => {
    expect(nextStatus(online, timeout, 2)).toEqual({ online: false, lastSeen: online.lastSeen, latencyMs: null, problem: NO_ANSWER_IN_TIME, detail: "no answer within 5 s" });
  });

  it("marks a refused connection offline at once, and never revives an offline peer on a timeout", () => {
    expect(nextStatus(online, refused, 0).online).toBe(false);
    expect(nextStatus({ ...online, online: false }, timeout, 1).online).toBe(false);
  });
});

describe("ingest", () => {
  it("passes an event the hub cannot read on to the app, which reads tolerantly, and keeps it out of the cache", () => {
    const cache = createPeerCache();
    const seen: string[] = [];
    const warnings: string[] = [];
    const log = createLogger((line) => { warnings.push(line); }, (): Date => new Date());
    const raw = JSON.stringify({ type: "an_event_of_a_newer_peer", payload: 1 });
    ingest(cache, new Set([(event: string): void => { seen.push(event); }]), log, "peer")(raw);
    expect(seen).toEqual([raw]);
    expect(cache.machine()).toBeNull();
    expect(warnings.join("")).toContain("hub_unreadable_event");
  });
});
