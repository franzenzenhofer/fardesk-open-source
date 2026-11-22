// A peer daemon as a coordinator endpoint: its sessions (remote.ts) and its self-update (remoteUpdate.ts).
import type { Peer } from "../contract/schema.js";
import { createSessionEndpoint } from "./remote.js";
import { updateCalls } from "./remoteUpdate.js";
import type { MachineEndpoint } from "./types.js";

export function createRemoteEndpoint(peer: Peer, token: string): MachineEndpoint {
  return { ...createSessionEndpoint(peer, token), ...updateCalls(peer, token) };
}
