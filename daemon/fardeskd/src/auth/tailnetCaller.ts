// Who is calling? Asks the local Tailscale daemon (`tailscale whois --json <address>`) and admits only a device of
// the same tailnet user as this computer, plus the logins and tags the owner listed under `pairing`. Fails closed.
import { z } from "zod";
import type { RunCommand } from "../config/bind.js";
import { isLoopbackAddress } from "../config/tailnetAddress.js";
import { createTailscaleProbe } from "../config/tailscale.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import type { LoginLimiter } from "./rateLimit.js";

export const PAIRING_REFUSED_MESSAGE = "This device is not allowed to pair with this computer";
export const PAIRING_UNVERIFIED_MESSAGE = "Tailscale could not identify this device, pairing refused";
const IPV4_MAPPED_PREFIX = "::ffff:";
const UNKNOWN_DEVICE = "unknown";

const whoisSchema = z.object({
  Node: z.object({ Name: z.string().optional(), Tags: z.array(z.string()).nullish() }),
  UserProfile: z.object({ LoginName: z.string().optional() }).nullish(),
});

export type Whois = { device: string; tailnet: string; login: string | null; tags: string[] };

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

/** `check` resolves with the caller's tailnet device name, or null for a caller on this computer. */
export type TailnetGate = { check: (ip: string) => Promise<string | null> };
export type TailnetGateDeps = { run: RunCommand; commands: string[]; policy: TailnetPolicy; log: Logger };

/** `host.tailnet.ts.net.` -> device `host`, tailnet `tailnet.ts.net`. */
function splitName(name: string): { device: string; tailnet: string } {
  const [first = "", ...rest] = name.replace(/\.$/, "").toLowerCase().split(".");
  return { device: first === "" ? UNKNOWN_DEVICE : first, tailnet: rest.join(".") };
}

export function parseWhois(raw: string): Whois {
  const parsed = whoisSchema.parse(JSON.parse(raw));
  const tags = parsed.Node.Tags ?? [];
  const login = tags.length > 0 ? null : (parsed.UserProfile?.LoginName?.toLowerCase() ?? null);
  return { ...splitName(parsed.Node.Name ?? ""), login, tags };
}

function admits(caller: Whois, self: Whois, policy: TailnetPolicy): boolean {
  if (caller.tags.length > 0) return caller.tailnet === self.tailnet && caller.tags.some((tag) => policy.allowedTags.includes(tag));
  if (caller.login === null) return false;
  if (policy.allowedUsers.some((user) => user.toLowerCase() === caller.login)) return true;
  return caller.login === self.login && caller.tailnet === self.tailnet;
}

/** `::ffff:100.64.0.7` (a dual-stack listener) -> `100.64.0.7`. */
const plainAddress = (ip: string): string => (ip.startsWith(IPV4_MAPPED_PREFIX) ? ip.slice(IPV4_MAPPED_PREFIX.length) : ip);

export const isLocalCaller = (ip: string): boolean => isLoopbackAddress(plainAddress(ip));

/** Whois of one address; a failing command or an unreadable answer is "could not identify" (fail closed). */
async function lookup(run: RunCommand, command: string, address: string, fail: () => PairingRefused): Promise<Whois> {
  try {
    return parseWhois(await run(command, ["whois", "--json", address]));
  } catch {
    throw fail();
  }
}

export function createTailnetGate({ run, commands, policy, log }: TailnetGateDeps): TailnetGate {
  let knownSelf: { address: string; whois: Whois } | null = null;
  const probe = createTailscaleProbe(commands, run, (line) => { log.info(line); });
  const unverified = (reason: string, device: string | null): PairingRefused => {
    log.warn("pairing_unverified", { reason });
    return new PairingRefused(PAIRING_UNVERIFIED_MESSAGE, device);
  };
  return {
    async check(rawIp): Promise<string | null> {
      if (isLocalCaller(rawIp)) return null;
      const ip = plainAddress(rawIp);
      const state = await probe();
      const command = probe.command();
      if (state.kind !== "running" || command === null) throw unverified(`tailscale ${state.kind}`, null);
      const caller = await lookup(run, command, ip, () => unverified("whois of the caller failed", null));
      const self = knownSelf?.address === state.address
        ? knownSelf.whois
        : await lookup(run, command, state.address, () => unverified("whois of this computer failed", caller.device));
      knownSelf = { address: state.address, whois: self };
      if (admits(caller, self, policy)) return caller.device;
      log.warn("pairing_refused", { device: caller.device });
      throw new PairingRefused(PAIRING_REFUSED_MESSAGE, caller.device);
    },
  };
}

/** Rate limit, then the tailnet check; a refusal counts as a failed attempt of that address. */
export async function admitTailnetCaller(limiter: LoginLimiter, gate: TailnetGate, ip: string): Promise<string | null> {
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
