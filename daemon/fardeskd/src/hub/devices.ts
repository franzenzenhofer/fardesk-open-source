// A phone in hub mode registers its APNs token at the hub only; every peer pushes for its own sessions, so the hub passes it on.
import type { DeviceRequest } from "../contract/schema.js";
import { createLogger, stderrSink } from "../core/log.js";
import type { Logger } from "../core/log.js";
import type { RouteHooks } from "../server/routes.js";
import type { Hub } from "./hub.js";

const REGISTER_TIMEOUT_MS = 15_000;

async function registerOn(hub: Hub, name: string, request: DeviceRequest, log: Logger): Promise<void> {
  const peer = hub.peer(name);
  if (peer === undefined) return;
  if (!peer.status().online) {
    log.warn("hub_device_not_forwarded", { peer: name, reason: "offline" });
    return;
  }
  try {
    const body = new TextEncoder().encode(JSON.stringify(request)).buffer;
    const response = await peer.call({ method: "POST", path: "/v1/devices", headers: { "content-type": "application/json" }, body, timeoutMs: REGISTER_TIMEOUT_MS });
    if (!response.ok) log.warn("hub_device_not_forwarded", { peer: name, reason: `HTTP ${response.status}` });
  } catch (error) {
    log.warn("hub_device_not_forwarded", { peer: name, reason: String(error) });
  }
}

/** Registers the device on every linked peer, all at once. A peer that cannot take it is logged, never fails the hub's own registration. */
export async function registerOnPeers(hub: Hub, request: DeviceRequest, log: Logger): Promise<void> {
  const peers = hub.machineNames().filter((name) => name !== hub.name);
  await Promise.all(peers.map(async (name) => registerOn(hub, name, request, log)));
}

export function hubRouteHooks(hub: Hub): RouteHooks {
  const log = createLogger(stderrSink, () => new Date());
  return { deviceRegistered: async (request) => registerOnPeers(hub, request, log) };
}
