// A paired device is bound to the Tailscale node it paired from (#108): the node's StableID plus its tags, never the
// user id (all tagged nodes share one). The master token counts only from this computer, its own node, or the hub's node.
import { isLoopbackAddress } from "../config/tailnetAddress.js";
import { FardeskError } from "../core/errors.js";
import { plainAddress } from "./nodeIdentity.js";
import type { NodeIdentity, NodeInfo } from "./nodeIdentity.js";

export const DEVICE_MOVED_MESSAGE = "This device was paired from another Tailscale device. Pair again.";
export const MASTER_WRONG_NODE_MESSAGE = "the master token counts only from this computer or its hub";

export type NodeBinding = { stableId: string; tags: string[] };

/** A caller on this computer's loopback interface (reachable only from this computer; only test daemons listen there). */
export const LOOPBACK_NODE: NodeBinding = { stableId: "loopback", tags: [] };

export const bindingOf = (node: NodeInfo): NodeBinding => ({ stableId: node.stableId, tags: [...node.tags].sort() });

/** Both bindings carry sorted tags (`bindingOf`). */
export const sameNode = (a: NodeBinding, b: NodeBinding): boolean =>
  a.stableId === b.stableId && a.tags.length === b.tags.length && a.tags.every((tag, index) => tag === b.tags[index]);

export const isLoopbackCaller = (ip: string): boolean => isLoopbackAddress(plainAddress(ip));

export type CallerNodes = {
  /** The node a request comes from: 401 for an address outside the tailnet (or none), 503 when Tailscale does not answer. */
  nodeOf: (ip: string, fresh?: boolean) => Promise<NodeBinding>;
  /** Passes the master token's source: this computer, or the configured hub; else 401 `master_token_wrong_node`. */
  requireMasterSource: (ip: string, fresh?: boolean) => Promise<void>;
};

async function isHub(identity: NodeIdentity, hubAddress: string | null, caller: NodeInfo, fresh: boolean): Promise<boolean> {
  if (hubAddress === null) return false;
  try {
    return (await identity.resolve(hubAddress, fresh)).stableId === caller.stableId;
  } catch (error) {
    if (error instanceof FardeskError && error.code === "unauthorized") return false;
    throw error;
  }
}

export function createCallerNodes(identity: NodeIdentity, hubAddress: string | null): CallerNodes {
  return {
    async nodeOf(ip, fresh = false): Promise<NodeBinding> {
      return isLoopbackCaller(ip) ? LOOPBACK_NODE : bindingOf(await identity.resolve(ip, fresh));
    },
    async requireMasterSource(ip, fresh = false): Promise<void> {
      if (isLoopbackCaller(ip)) return;
      const caller = await identity.resolve(ip, fresh);
      if ((await identity.self(fresh)).stableId === caller.stableId) return;
      if (await isHub(identity, hubAddress, caller, fresh)) return;
      throw new FardeskError("master_token_wrong_node", MASTER_WRONG_NODE_MESSAGE);
    },
  };
}
