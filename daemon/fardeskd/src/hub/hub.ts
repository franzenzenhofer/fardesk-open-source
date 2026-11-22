// The hub: one monitor per peer plus the state table of every machine (this one first).
import type { Config } from "../config/config.js";
import type { HubMachine, HubState } from "../contract/schema.js";
import { createLogger, stderrSink } from "../core/log.js";
import type { Logger } from "../core/log.js";
import type { Services } from "../service/types.js";
import { createPeerMonitor } from "./monitor.js";
import type { PeerMonitor } from "./monitor.js";

export type Hub = {
  /** This machine's name. */
  readonly name: string;
  state(): HubState;
  peer(name: string): PeerMonitor | undefined;
  /** Every machine name the hub serves, itself first. */
  machineNames(): string[];
  close(): void;
};

function count(sessions: readonly { status: string }[], status: string): number {
  return sessions.filter((session) => session.status === status).length;
}

function summarize(name: string, sessions: readonly { status: string }[]): Pick<HubMachine, "name" | "sessions" | "waiting" | "working"> {
  return { name, sessions: sessions.length, waiting: count(sessions, "waiting"), working: count(sessions, "working") };
}

function peerEntry(monitor: PeerMonitor): HubMachine {
  const { online, lastSeen, latencyMs, problem, detail } = monitor.status();
  const os = monitor.cache.machine()?.os;
  return { ...summarize(monitor.name, monitor.cache.sessions()), online, hub: false, lastSeen, latencyMs, problem, detail, ...(os === undefined ? {} : { os }) };
}

export function createHub(config: Config, services: Services, log?: Logger): Hub {
  const logger = log ?? createLogger(stderrSink, () => new Date());
  const monitors = new Map<string, PeerMonitor>();
  for (const peer of config.peers) {
    if (peer.name === config.name) continue;
    const token = config.coordinator.peerTokens[peer.name] ?? null;
    monitors.set(peer.name, createPeerMonitor({ name: peer.name, url: peer.url, token, probeMs: config.hub.probeMs, log: logger }));
  }
  return {
    name: config.name,
    state(): HubState {
      const own: HubMachine = { ...summarize(config.name, services.sessions()), online: true, hub: true, lastSeen: new Date().toISOString(), latencyMs: 0, problem: null, detail: null, os: services.machine().os };
      return { hub: config.name, checkedAt: new Date().toISOString(), machines: [own, ...[...monitors.values()].map(peerEntry)] };
    },
    peer: (name) => monitors.get(name),
    machineNames: () => [config.name, ...monitors.keys()],
    close(): void {
      for (const monitor of monitors.values()) monitor.close();
    },
  };
}

export function startHub(config: Config, services: Services): Hub | null {
  return config.hub.enabled ? createHub(config, services) : null;
}
