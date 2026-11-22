// Watches one peer: a live upstream stream for the cache plus a periodic GET /v1/machine probe for online/latency.
import { z } from "zod";
import { sessionSummarySchema, streamEventSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { createPeerCache } from "./cache.js";
import type { PeerCache } from "./cache.js";
import { callPeer, PROBE_TIMEOUT_MS, probePeer } from "./probe.js";
import type { PeerCall, PeerLink, ProbeResult } from "./probe.js";
import { NOT_LINKED, SLOW_ANSWER } from "./failure.js";
import { openUpstream } from "./upstream.js";

export type { PeerCall } from "./probe.js";



/** `problem`: a sentence for a non-specialist; `detail`: the technical cause, for support. Both null while online. */
export type PeerStatus = { online: boolean; lastSeen: string | null; latencyMs: number | null; problem: string | null; detail: string | null };

export type PeerMonitor = {
  readonly name: string;
  readonly cache: PeerCache;
  status(): PeerStatus;
  /** True while the upstream stream is open, i.e. while the cache is current. */
  streamLive(): boolean;
  /** Receives the raw text of every upstream stream message. */
  subscribe(listener: (raw: string) => void): () => void;
  /** One authorised request to the peer; throws `machine_offline` when it does not answer. */
  call(call: PeerCall): Promise<Response>;
  close(): void;
};

export type MonitorOptions = { name: string; url: string; token: string | null; probeMs: number; log: Logger };

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

type Listeners = Set<(raw: string) => void>;

export function ingest(cache: PeerCache, listeners: Listeners, log: Logger, name: string): (raw: string) => void {
  return (raw) => {
    // The app reads every event tolerantly (VERSIONING.md), so the raw event always goes on to it; only the hub's own
    // cache skips an event it cannot read, such as a new event type of a newer 4.x peer.
    const parsed = streamEventSchema.safeParse(parseJson(raw));
    if (parsed.success) cache.apply(parsed.data);
    else log.warn("hub_unreadable_event", { peer: name });
    for (const listener of listeners) listener(raw);
  };
}

type Watch = { stop(): void };
type Shared = { status: PeerStatus; live: boolean };

function tell(listeners: Listeners, event: unknown): void {
  const raw = JSON.stringify(event);
  for (const listener of listeners) listener(raw);
}

/**
 * Re-reads the peer's session list. Clients get a fresh hello only when a session left the list (the stream cannot
 * say that); otherwise one session event per session that really changed. Resolves to the failure, if any.
 */
async function reconcile(link: PeerLink, cache: PeerCache, listeners: Listeners): Promise<Error | null> {
  const readStartedAt = Date.now();
  try {
    const response = await callPeer(link, { method: "GET", path: "/v1/sessions", timeoutMs: PROBE_TIMEOUT_MS });
    const diff = cache.reconcileSessions(z.array(sessionSummarySchema).parse(await response.json()), readStartedAt);
    if (diff.kind === "changed") for (const session of diff.sessions) tell(listeners, { type: "session", session });
    const machine = cache.machine();
    if (diff.kind === "removed" && machine !== null) tell(listeners, { type: "hello", machine, sessions: diff.sessions });
    return null;
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

type ProbeDeps = { link: PeerLink; cache: PeerCache; shared: Shared; listeners: Listeners; log: Logger };

/** Probes in a row that may time out before an online peer counts as offline. */
export const SLOW_PROBES_TOLERATED = 1;

/**
 * The status after one probe. A busy Mac answered in up to 4.6 s and once not within 5 s
 * (audit 2026-11-16, F1/F2): one slow probe must not blank its sessions everywhere, so a single
 * timeout keeps an online peer online. A refused connection is definitive at once.
 */
export function nextStatus(previous: PeerStatus, result: ProbeResult, slowInARow: number): PeerStatus {
  if (result.online) return { online: true, lastSeen: new Date().toISOString(), latencyMs: result.latencyMs, problem: null, detail: null };
  const tolerated = previous.online && result.timedOut && slowInARow <= SLOW_PROBES_TOLERATED;
  if (tolerated) return { ...previous, latencyMs: null, problem: SLOW_ANSWER, detail: result.detail };
  return { online: false, lastSeen: previous.lastSeen, latencyMs: result.latencyMs, problem: result.problem, detail: result.detail };
}

function watchProbe({ link, cache, shared, listeners, log }: ProbeDeps, probeMs: number): Watch {
  let timer: NodeJS.Timeout | null = null;
  let closed = false;
  let slowInARow = 0;
  const loop = async (): Promise<void> => {
    const [result, reconcileFailure] = await Promise.all([probePeer(link), reconcile(link, cache, listeners)]);
    if (result.machine !== null) cache.setMachine(result.machine);
    if (result.online && reconcileFailure !== null) log.warn("hub_reconcile_failed", { peer: link.name, error: String(reconcileFailure) });
    slowInARow = result.timedOut ? slowInARow + 1 : 0;
    shared.status = nextStatus(shared.status, result, slowInARow);
    if (!closed) timer = setTimeout(() => { void loop(); }, probeMs);
  };
  void loop();
  return {
    stop(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}

export function createPeerMonitor(options: MonitorOptions): PeerMonitor {
  const { name, token } = options;
  const link = token === null ? null : { name, baseUrl: options.url.replace(/\/+$/, ""), token };
  const cache = createPeerCache();
  const listeners = new Set<(raw: string) => void>();
  const shared: Shared = { status: { online: false, lastSeen: null, latencyMs: null, ...(link === null ? NOT_LINKED : { problem: "not checked yet", detail: null }) }, live: false };
  const onMessage = ingest(cache, listeners, options.log, name);
  const upstream = link === null ? null : openUpstream({ baseUrl: link.baseUrl, token: link.token, onMessage, onLive: (isLive) => { shared.live = isLive; } });
  const watch = link === null ? null : watchProbe({ link, cache, shared, listeners, log: options.log }, options.probeMs);
  return {
    name,
    cache,
    status: () => shared.status,
    streamLive: () => shared.live,
    subscribe(listener): () => void {
      listeners.add(listener);
      return (): void => { listeners.delete(listener); };
    },
    call: async (call) => (link === null ? Promise.reject(new FardeskError("machine_offline", `${name} is ${NOT_LINKED.detail}`)) : callPeer(link, call)),
    close(): void {
      watch?.stop();
      upstream?.close();
    },
  };
}
