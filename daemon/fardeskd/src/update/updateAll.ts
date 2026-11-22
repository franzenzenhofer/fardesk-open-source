// "Update all": find the newest version in the fleet, take that machine's release package and hand it to every older machine.
// The machine that runs this (the hub) is updated last, because its own restart ends the request.
import type { UpdateAllMachine, UpdateAllResult } from "../contract/schema.js";
import type { Machine as FleetMember } from "../coordinator/local.js";
import { FardeskError } from "../core/errors.js";
import { compareVersions, isOlder } from "../core/semver.js";
import { sha256Hex } from "./ownPackage.js";

type Seen = { name: string; endpoint: FleetMember["endpoint"]; version: string | null; problem: string | null };
type Package = { bytes: Uint8Array; sha256: string };

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : "request failed");

async function inspect(member: FleetMember): Promise<Seen> {
  const base = { name: member.name, endpoint: member.endpoint };
  if (member.endpoint === null) return { ...base, version: null, problem: `${member.name} is not linked to this hub (no token in coordinator.peerTokens)` };
  try {
    const { version } = await member.endpoint.machine();
    compareVersions(version, version);
    return { ...base, version, problem: null };
  } catch (error) {
    return { ...base, version: null, problem: `${member.name} could not be read: ${reasonOf(error)}` };
  }
}

function newestOf(seen: Seen[]): { version: string; holders: Seen[] } {
  const versions = seen.flatMap((entry) => (entry.version === null ? [] : [entry.version]));
  const [first, ...rest] = versions;
  if (first === undefined) throw new FardeskError("unsupported", "no machine of this fleet could be read, so there is nothing to update from");
  const version = rest.reduce((best, candidate) => (compareVersions(candidate, best) > 0 ? candidate : best), first);
  return { version, holders: seen.filter((entry) => entry.version === version) };
}

async function fetchPackage(holders: Seen[]): Promise<{ source: string; pack: Package }> {
  const reasons: string[] = [];
  for (const holder of holders) {
    try {
      const bytes = await holder.endpoint?.updatePackage();
      if (bytes !== undefined) return { source: holder.name, pack: { bytes, sha256: sha256Hex(bytes) } };
    } catch (error) {
      reasons.push(`${holder.name}: ${reasonOf(error)}`);
    }
  }
  throw new FardeskError("not_found", `no machine with the newest version can give its release package (${reasons.join("; ")})`);
}

async function push(target: Seen, version: string, pack: Package): Promise<UpdateAllMachine> {
  const base = { name: target.name, from: target.version };
  try {
    await target.endpoint?.startUpdate(pack.bytes, pack.sha256);
    return { ...base, result: "started", message: `installing ${version}, restarts when done` };
  } catch (error) {
    return { ...base, result: "failed", message: `${target.name} refused the update: ${reasonOf(error)}` };
  }
}

function settled(entry: Seen, version: string): UpdateAllMachine | null {
  if (entry.problem !== null) return { name: entry.name, from: null, result: "failed", message: entry.problem };
  if (entry.version !== null && !isOlder(entry.version, version)) return { name: entry.name, from: entry.version, result: "current", message: `already on ${entry.version}` };
  return null;
}

/** The machines come with this machine first; `localName` is the one that restarts itself, so it goes last. */
export async function updateAll(fleet: FleetMember[], localName: string): Promise<UpdateAllResult> {
  const seen = await Promise.all(fleet.map(inspect));
  const { version, holders } = newestOf(seen);
  const results = new Map<string, UpdateAllMachine>();
  const outdated: Seen[] = [];
  for (const entry of seen) {
    const done = settled(entry, version);
    if (done === null) outdated.push(entry);
    else results.set(entry.name, done);
  }
  const first = holders[0];
  if (first === undefined) throw new FardeskError("internal", "no machine holds the newest version");
  let source = first.name;
  if (outdated.length > 0) {
    const fetched = await fetchPackage(holders);
    source = fetched.source;
    const peers = outdated.filter((entry) => entry.name !== localName);
    for (const result of await Promise.all(peers.map(async (entry) => push(entry, version, fetched.pack)))) results.set(result.name, result);
    for (const entry of outdated.filter((candidate) => candidate.name === localName)) results.set(entry.name, await push(entry, version, fetched.pack));
  }
  return { source, version, machines: fleet.flatMap((member) => results.get(member.name) ?? []) };
}
