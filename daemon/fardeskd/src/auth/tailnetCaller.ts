// Who is calling? Asks the node identity (`tailscale whois`, nodeIdentity.ts) and admits only a device of the same
// tailnet user as this computer, plus the logins and tags the owner listed under `pairing`. Fails closed.
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { LOOPBACK_NODE, bindingOf, isLoopbackCaller } from "./nodeBinding.js";
import type { NodeBinding } from "./nodeBinding.js";
import type { NodeIdentity, NodeInfo } from "./nodeIdentity.js";
import type { AttemptLimiter } from "./rateLimit.js";

export const PAIRING_REFUSED_MESSAGE = "This device is not allowed to pair with this computer";
export const PAIRING_UNVERIFIED_MESSAGE = "Tailscale could not identify this device, pairing refused";

export type TailnetPolicy = { allowedUsers: string[]; allowedTags: string[] };

/** The refusal of a pairing request; `device` is the caller's tailnet device name for the audit line (null when unknown). */
export class PairingRefused extends FardeskError {
  readonly device: string | null;

  constructor(message: string, device: string | null) {
    super("forbidden", message);
    this.name = "PairingRefused";
    this.device = device;
  }
}

/** The admitted caller: its tailnet device name (null for a caller on this computer) and the node it is bound to. */
export type Admitted = { device: string | null; node: NodeBinding };
export type TailnetGate = { check: (ip: string) => Promise<Admitted> };
export type TailnetGateDeps = { identity: NodeIdentity; policy: TailnetPolicy; log: Logger };

function admits(caller: NodeInfo, self: NodeInfo, policy: TailnetPolicy): boolean {
  if (caller.tags.length > 0) return caller.tailnet === self.tailnet && caller.tags.some((tag) => policy.allowedTags.includes(tag));
  if (caller.login === null) return false;
  if (policy.allowedUsers.some((user) => user.toLowerCase() === caller.login)) return true;
  return caller.login === self.login && caller.tailnet === self.tailnet;
}

export const isLocalCaller = isLoopbackCaller;

export function createTailnetGate({ identity, policy, log }: TailnetGateDeps): TailnetGate {
  const unverified = (reason: string, device: string | null): PairingRefused => {
    log.warn("pairing_unverified", { reason });
    return new PairingRefused(PAIRING_UNVERIFIED_MESSAGE, device);
  };
  return {
    async check(ip): Promise<Admitted> {
      if (isLocalCaller(ip)) return { device: null, node: LOOPBACK_NODE };
      // A pairing is decided on fresh facts: whois is asked again, whatever the cache holds.
      const caller = await identity.resolve(ip, true).catch(() => { throw unverified("whois of the caller failed", null); });
      const self = await identity.self(true).catch(() => { throw unverified("whois of this computer failed", caller.device); });
      if (admits(caller, self, policy)) return { device: caller.device, node: bindingOf(caller) };
      log.warn("pairing_refused", { device: caller.device });
      throw new PairingRefused(PAIRING_REFUSED_MESSAGE, caller.device);
    },
  };
}

/** Rate limit, then the tailnet check; a refusal counts as a failed attempt of that address. */
export async function admitTailnetCaller(limiter: AttemptLimiter, gate: TailnetGate, ip: string): Promise<Admitted> {
  const release = limiter.reserve(ip);
  try {
    return await gate.check(ip);
  } catch (error) {
    limiter.recordFailure(ip);
    throw error;
  } finally {
    release();
  }
}
