// The two refusals every hub entry point shares: unknown machine (404) and known-offline machine (503).
import { FardeskError } from "../core/errors.js";
import type { Hub } from "./hub.js";
import type { PeerMonitor } from "./monitor.js";

export function decodeMachine(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new FardeskError("invalid_request", `machine name "${raw}" is not valid URL encoding`);
  }
}

export function knownPeer(hub: Hub, name: string): PeerMonitor {
  const peer = hub.peer(name);
  if (peer === undefined) throw new FardeskError("not_found", `no machine "${name}"; known machines: ${hub.machineNames().join(", ")}`);
  return peer;
}

export function requireOnline(peer: PeerMonitor): void {
  const { online, problem, detail, lastSeen } = peer.status();
  if (!online) throw new FardeskError("machine_offline", `${peer.name} is offline: ${problem ?? "unknown"}${detail === null ? "" : ` (${detail})`}; last seen ${lastSeen ?? "never"}`);
}
