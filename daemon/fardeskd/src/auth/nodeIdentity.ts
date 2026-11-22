// Who is at the other end? The Tailscale node the connection comes from, asked of the local Tailscale daemon with
// `tailscale whois --json <source address>` (through the deadline-bound command runner). Identity in Fardesk is the
// Tailscale node (#108). Fails closed: Tailscale not answering is 503 `tailscale_unavailable`, an address that is not a
// node of the tailnet is 401.
import { z } from "zod";
import type { RunCommand } from "../config/bind.js";
import { isNodeAddress } from "../config/tailnetOnly.js";
import { createTailscaleProbe } from "../config/tailscale.js";
import type { TailscaleProbe } from "../config/tailscale.js";
import { FardeskError } from "../core/errors.js";

export const WHOIS_CACHE_MS = 60_000;
export const TAILSCALE_UNAVAILABLE_MESSAGE = "Tailscale on this computer is not running";
export const NOT_IN_TAILNET_MESSAGE = "this address is not a device of the tailnet";
const IPV4_MAPPED_PREFIX = "::ffff:";
const PREFIX_LENGTH_SUFFIX = /\/\d+$/;
const UNKNOWN_DEVICE = "unknown";
const DEADLINE_MESSAGE = "did not answer within";

const whoisSchema = z.object({
  Node: z.object({
    StableID: z.string().min(1),
    Name: z.string().optional(),
    Addresses: z.array(z.string()).nullish(),
    Tags: z.array(z.string()).nullish(),
  }),
  UserProfile: z.object({ ID: z.union([z.number(), z.string()]).optional(), LoginName: z.string().optional() }).nullish(),
});

/** What Tailscale says about one node. `userId` is shared by all tagged nodes, so it never identifies a device on its own. */
export type NodeInfo = {
  stableId: string;
  userId: string | null;
  tags: string[];
  addresses: string[];
  /** The device name (`host` of `host.tailnet.ts.net.`). */
  device: string;
  tailnet: string;
  /** Login of the owning user; null for a tagged node. */
  login: string | null;
};

export type NodeIdentity = {
  /** The node behind a source address; cached per address for `WHOIS_CACHE_MS`, `fresh` asks Tailscale again. */
  resolve: (address: string, fresh?: boolean) => Promise<NodeInfo>;
  /** The node of this computer itself (whois of its own tailnet address). */
  self: (fresh?: boolean) => Promise<NodeInfo>;
};

export type NodeIdentityDeps = { run: RunCommand; commands: string[]; now: () => number; cacheMs?: number | undefined; log: (line: string) => void };

/** `::ffff:100.64.0.7` (a dual-stack listener) -> `100.64.0.7`. */
export const plainAddress = (ip: string): string => (ip.startsWith(IPV4_MAPPED_PREFIX) ? ip.slice(IPV4_MAPPED_PREFIX.length) : ip);

/** `host.tailnet.ts.net.` -> device `host`, tailnet `tailnet.ts.net`. */
function splitName(name: string): { device: string; tailnet: string } {
  const [first = "", ...rest] = name.replace(/\.$/, "").toLowerCase().split(".");
  return { device: first === "" ? UNKNOWN_DEVICE : first, tailnet: rest.join(".") };
}

export function parseWhois(raw: string): NodeInfo {
  const parsed = whoisSchema.parse(JSON.parse(raw));
  const tags = parsed.Node.Tags ?? [];
  const user = parsed.UserProfile;
  return {
    ...splitName(parsed.Node.Name ?? ""),
    stableId: parsed.Node.StableID,
    userId: user?.ID === undefined ? null : String(user.ID),
    tags,
    addresses: (parsed.Node.Addresses ?? []).map((address) => address.replace(PREFIX_LENGTH_SUFFIX, "")),
    login: tags.length > 0 ? null : (user?.LoginName?.toLowerCase() ?? null),
  };
}

const unavailable = (): FardeskError => new FardeskError("tailscale_unavailable", TAILSCALE_UNAVAILABLE_MESSAGE);
const notInTailnet = (): FardeskError => new FardeskError("unauthorized", NOT_IN_TAILNET_MESSAGE);

/** Whois of one tailnet address through the probed Tailscale command; throws the refusal to give when it cannot say who it is. */
async function askTailscale(probe: TailscaleProbe, run: RunCommand, address: string): Promise<NodeInfo> {
  const state = await probe();
  const command = probe.command();
  if (state.kind !== "running" || command === null) throw unavailable();
  let raw: string;
  try {
    raw = await run(command, ["whois", "--json", address]);
  } catch (error) {
    // A running Tailscale that does not know the address answers "peer not found"; a hung or dead one is not that.
    throw (error as Error).message.includes(DEADLINE_MESSAGE) ? unavailable() : notInTailnet();
  }
  let node: NodeInfo;
  try {
    node = parseWhois(raw);
  } catch {
    throw unavailable();
  }
  if (!node.addresses.includes(address)) throw notInTailnet();
  return node;
}

export function createNodeIdentity({ run, commands, now, cacheMs = WHOIS_CACHE_MS, log }: NodeIdentityDeps): NodeIdentity {
  const probe = createTailscaleProbe(commands, run, log);
  const cache = new Map<string, { at: number; node: Promise<NodeInfo> }>();

  async function resolve(rawAddress: string, fresh = false): Promise<NodeInfo> {
    const address = plainAddress(rawAddress);
    if (!isNodeAddress(address)) throw notInTailnet();
    const hit = cache.get(address);
    if (!fresh && hit !== undefined && now() - hit.at < cacheMs) return hit.node;
    const node = askTailscale(probe, run, address);
    const entry = { at: now(), node };
    cache.set(address, entry);
    node.catch(() => { if (cache.get(address) === entry) cache.delete(address); });
    return node;
  }

  return {
    resolve,
    async self(fresh = false): Promise<NodeInfo> {
      const state = await probe();
      if (state.kind !== "running") throw unavailable();
      return resolve(state.address, fresh);
    },
  };
}
