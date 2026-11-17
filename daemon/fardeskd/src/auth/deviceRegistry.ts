// Device registry: one entry per issued token, only the SHA-256 of the token is stored. Revoked entries stay as tombstones.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { apnsEnvironmentSchema } from "../contract/schema.js";
import type { AuthDevice } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

export const REGISTRY_FILE = "auth-devices.json";
export const MASTER_DEVICE_ID = "master";
export const TOKEN_BYTES = 32;
export const LAST_SEEN_WRITE_INTERVAL_MS = 60_000;
export const TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

const entrySchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  lastIp: z.string().min(1).nullable(),
  revokedAt: z.iso.datetime().nullable(),
  apnsToken: z.string().min(1).nullable(),
  apnsEnvironment: apnsEnvironmentSchema.nullable(),
});
const fileSchema = z.strictObject({ devices: z.array(entrySchema) });

export type DeviceEntry = z.infer<typeof entrySchema>;
export type ApnsEnvironmentName = z.infer<typeof apnsEnvironmentSchema>;
export type AuthenticateResult = { state: "ok"; device: DeviceEntry } | { state: "revoked" } | { state: "unknown" };

export type DeviceRegistryOptions = {
  path: string;
  now: () => Date;
  lastSeenWriteIntervalMs?: number;
};

export type DeviceRegistry = {
  issue: (name: string, ip: string) => { token: string; device: DeviceEntry };
  authenticate: (token: string, ip: string) => AuthenticateResult;
  list: (currentId: string | null) => AuthDevice[];
  entries: () => DeviceEntry[];
  /** Revokes the active entries matching an id or an exact case-insensitive name; null revokes all. */
  revoke: (target: string | null) => DeviceEntry[];
  revokeAll: () => DeviceEntry[];
  attachPush: (deviceId: string, apnsToken: string, environment: ApnsEnvironmentName) => void;
  detachPush: (deviceId: string) => DeviceEntry | null;
};

export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");

const isActive = (entry: DeviceEntry): boolean => entry.revokedAt === null;

type Store = { all: () => DeviceEntry[]; add: (entry: DeviceEntry) => void; update: (entry: DeviceEntry) => void; persist: () => void };

function openStore({ path, now }: DeviceRegistryOptions): Store {
  const loaded = readJsonState(path, fileSchema, "device registry", { devices: [] }).devices;
  const cutoff = now().getTime() - TOMBSTONE_RETENTION_MS;
  let devices = loaded.filter((entry) => entry.revokedAt === null || Date.parse(entry.revokedAt) > cutoff);
  const persist = (): void => {
    writeJsonState(path, { devices });
  };
  if (devices.length !== loaded.length) persist();
  return {
    all: () => devices,
    add(entry): void {
      devices = [...devices, entry];
      persist();
    },
    update(entry): void {
      devices = devices.map((existing) => (existing.id === entry.id ? entry : existing));
    },
    persist,
  };
}

function newDevice(name: string, ip: string, createdAt: string): { token: string; device: DeviceEntry } {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const device: DeviceEntry = {
    id: randomUUID(),
    name,
    tokenHash: hashToken(token),
    createdAt,
    lastSeenAt: createdAt,
    lastIp: ip,
    revokedAt: null,
    apnsToken: null,
    apnsEnvironment: null,
  };
  return { token, device };
}

function createCredentials(store: Store, options: DeviceRegistryOptions): Pick<DeviceRegistry, "issue" | "authenticate"> {
  const writeIntervalMs = options.lastSeenWriteIntervalMs ?? LAST_SEEN_WRITE_INTERVAL_MS;
  const stamp = (): string => options.now().toISOString();
  const lastWritten = new Map<string, number>();
  const touch = (entry: DeviceEntry, ip: string): DeviceEntry => {
    const updated = { ...entry, lastSeenAt: stamp(), lastIp: ip };
    store.update(updated);
    if (options.now().getTime() - (lastWritten.get(entry.id) ?? 0) >= writeIntervalMs) {
      lastWritten.set(entry.id, options.now().getTime());
      store.persist();
    }
    return updated;
  };
  return {
    issue(name, ip): { token: string; device: DeviceEntry } {
      const { token, device } = newDevice(name, ip, stamp());
      lastWritten.set(device.id, options.now().getTime());
      store.add(device);
      return { token, device };
    },
    authenticate(token, ip): AuthenticateResult {
      const hash = hashToken(token);
      const entry = store.all().find((candidate) => candidate.tokenHash === hash);
      if (entry === undefined) return { state: "unknown" };
      return isActive(entry) ? { state: "ok", device: touch(entry, ip) } : { state: "revoked" };
    },
  };
}

function createRevocation(store: Store, now: () => Date): Pick<DeviceRegistry, "revoke" | "revokeAll"> {
  const revokeMatching = (matches: (entry: DeviceEntry) => boolean): DeviceEntry[] => {
    const revoked = store.all().filter((entry) => isActive(entry) && matches(entry)).map((entry) => ({ ...entry, revokedAt: now().toISOString() }));
    for (const entry of revoked) store.update(entry);
    if (revoked.length > 0) store.persist();
    return revoked;
  };
  const revokeAll = (): DeviceEntry[] => revokeMatching(() => true);
  return {
    revokeAll,
    revoke(target): DeviceEntry[] {
      if (target === null) return revokeAll();
      const wanted = target.toLowerCase();
      const revoked = revokeMatching((entry) => entry.id === target || entry.name.toLowerCase() === wanted);
      if (revoked.length === 0) throw new FardeskError("not_found", `no active device with id or name "${target}"`);
      return revoked;
    },
  };
}

function createPushRegistration(store: Store): Pick<DeviceRegistry, "attachPush" | "detachPush"> {
  const find = (deviceId: string): DeviceEntry | undefined => store.all().find((candidate) => candidate.id === deviceId);
  return {
    attachPush(deviceId, apnsToken, environment): void {
      const entry = find(deviceId);
      if (entry === undefined) return;
      store.update({ ...entry, apnsToken, apnsEnvironment: environment });
      store.persist();
    },
    detachPush(deviceId): DeviceEntry | null {
      const entry = find(deviceId);
      if (entry === undefined || entry.apnsToken === null) return null;
      store.update({ ...entry, apnsToken: null, apnsEnvironment: null });
      store.persist();
      return entry;
    },
  };
}

const toAuthDevice = (entry: DeviceEntry, currentId: string | null): AuthDevice => ({
  id: entry.id,
  name: entry.name,
  createdAt: entry.createdAt,
  lastSeenAt: entry.lastSeenAt,
  lastIp: entry.lastIp,
  revoked: !isActive(entry),
  current: entry.id === currentId,
});

export function createDeviceRegistry(options: DeviceRegistryOptions): DeviceRegistry {
  const store = openStore(options);
  return {
    ...createCredentials(store, options),
    ...createRevocation(store, options.now),
    ...createPushRegistration(store),
    list: (currentId) => store.all().map((entry) => toAuthDevice(entry, currentId)),
    entries: () => store.all(),
  };
}
