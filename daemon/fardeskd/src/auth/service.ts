// The auth facade: master token + device tokens, pairing by one-time code, revoke with wipe pushes.
import type { z } from "zod";
import type { AuditLog } from "../audit/store.js";
import type { RunCommand } from "../config/bind.js";
import type { Config } from "../config/config.js";
import { WIPE_COMMAND } from "../contract/schema.js";
import type { AuthDeviceList, DeviceRequest, LoginResult, logoutRequestSchema, Machine, PairCodeResult, PairRequest, RevokeRequest } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import type { ApnsClient } from "../push/apns.js";
import type { DeviceStore } from "../push/deviceStore.js";
import { MASTER_DEVICE_ID } from "./deviceRegistry.js";
import type { DeviceEntry, DeviceRegistry } from "./deviceRegistry.js";
import { createMasterToken } from "./masterToken.js";
import type { MasterToken } from "./masterToken.js";
import { createPairOps } from "./pairOps.js";
import type { PairOps } from "./pairOps.js";
import { createCallerNodes, DEVICE_MOVED_MESSAGE, sameNode } from "./nodeBinding.js";
import type { CallerNodes, NodeBinding } from "./nodeBinding.js";
import { createNodeIdentity, WHOIS_CACHE_MS } from "./nodeIdentity.js";
import { createTailnetGate } from "./tailnetCaller.js";

type LogoutRequest = z.infer<typeof logoutRequestSchema>;

export type Caller = { state: "ok"; deviceId: string } | { state: "revoked" } | { state: "unknown" };

export type AuthDeps = {
  config: Config;
  configPath: string;
  registry: DeviceRegistry;
  pushDevices: DeviceStore;
  apns: Pick<ApnsClient, "sendBackground"> | null;
  machine: () => Machine;
  /** Runs the Tailscale CLI to find out who a pairing caller is. */
  run: RunCommand;
  tailscaleCommands: string[];
  /** How long a whois answer is trusted (default 60 s); tests shorten it. */
  whoisCacheMs?: number | undefined;
  log: Logger;
  audit: AuditLog;
  now: () => number;
};

export type AuthService = {
  /**
   * Who the token belongs to, when it comes from the node it belongs to. Throws 401 `device_moved` / `master_token_wrong_node` /
   * `unauthorized` (source not in the tailnet), 503 `tailscale_unavailable`. `fresh` asks Tailscale again instead of the cache.
   */
  authenticate: (token: string, ip: string, fresh?: boolean) => Promise<Caller>;
  /** How often an open stream is checked again (the whois cache lifetime). */
  nodeCheckMs: number;
  /** Opens the pairing window (cancels the open one): a fresh single-use code, valid 2 minutes, for the pairing link. */
  openPairWindow: (callerId: string) => PairCodeResult;
  pairWindowStatus: PairOps["pairWindowStatus"];
  closePairWindow: PairOps["closePairWindow"];
  /** Exchanges a pairing code for a device token (no bearer needed). */
  pair: (request: PairRequest, ip: string) => Promise<LoginResult>;
  rotateToken: (callerId: string) => void;
  /** Rate limit + tailnet gate of `pair` alone: the hub runs it before it forwards an anonymous pairing request to a peer. */
  verifyPairingCaller: (ip: string) => Promise<void>;
  logout: (deviceId: string, request: LogoutRequest) => void;
  devices: (currentId: string) => AuthDeviceList;
  revoke: (request: RevokeRequest) => Promise<{ revoked: number }>;
  attachPush: (deviceId: string, request: DeviceRequest) => void;
  onRevoked: (listener: (deviceIds: string[]) => void) => () => void;
};

type Retirement = {
  closeSockets: (entries: DeviceEntry[]) => void;
  unregisterPush: (entries: DeviceEntry[]) => void;
  retireWithWipe: (entries: DeviceEntry[]) => Promise<void>;
  onRevoked: AuthService["onRevoked"];
};

async function wipePush({ apns, log }: AuthDeps, entry: DeviceEntry): Promise<void> {
  if (apns === null || entry.apnsToken === null || entry.apnsEnvironment === null) return;
  try {
    await apns.sendBackground(entry.apnsToken, entry.apnsEnvironment, { command: WIPE_COMMAND });
  } catch (error) {
    log.warn("wipe_push_failed", { deviceId: entry.id, error: String(error) });
  }
}

function createRetirement(deps: AuthDeps): Retirement {
  const { pushDevices, log } = deps;
  const listeners = new Set<(deviceIds: string[]) => void>();
  const closeSockets = (entries: DeviceEntry[]): void => {
    for (const listener of listeners) listener(entries.map((entry) => entry.id));
  };
  const unregisterPush = (entries: DeviceEntry[]): void => {
    for (const entry of entries) if (entry.apnsToken !== null) pushDevices.remove(entry.apnsToken);
  };
  return {
    closeSockets,
    unregisterPush,
    async retireWithWipe(entries): Promise<void> {
      closeSockets(entries);
      await Promise.all(entries.map(async (entry) => wipePush(deps, entry)));
      unregisterPush(entries);
      log.info("devices_revoked", { count: entries.length });
    },
    onRevoked(listener): () => void {
      listeners.add(listener);
      return (): void => {
        listeners.delete(listener);
      };
    },
  };
}

type Parts = { deps: AuthDeps; retirement: Retirement; master: MasterToken; nodes: CallerNodes };

function issueLoginFor(deps: AuthDeps): (deviceName: string, ip: string, node: NodeBinding) => LoginResult {
  return (deviceName, ip, node) => {
    const { token, device } = deps.registry.issue(deviceName, ip, node);
    deps.log.info("device_logged_in", { deviceId: device.id });
    return { token, deviceId: device.id, machine: deps.machine(), peers: deps.config.peers };
  };
}

function createSessionOps({ deps, retirement, master, nodes }: Parts): Pick<AuthService, "authenticate" | "logout" | "devices" | "attachPush"> {
  const { registry } = deps;
  return {
    async authenticate(token, ip, fresh): Promise<Caller> {
      if (master.matches(token)) {
        await nodes.requireMasterSource(ip, fresh);
        return { state: "ok", deviceId: MASTER_DEVICE_ID };
      }
      const result = registry.find(token);
      if (result.state !== "ok") return result;
      if (!sameNode(await nodes.nodeOf(ip, fresh), result.device)) throw new FardeskError("device_moved", DEVICE_MOVED_MESSAGE);
      registry.seen(result.device.id, ip);
      return { state: "ok", deviceId: result.device.id };
    },
    logout(deviceId, request): void {
      if (deviceId === MASTER_DEVICE_ID) throw new FardeskError("invalid_request", "the pairing token cannot log out");
      const revoked = registry.revoke(deviceId);
      retirement.closeSockets(revoked);
      retirement.unregisterPush(revoked);
      if (request.apnsToken !== null) deps.pushDevices.remove(request.apnsToken);
    },
    devices: (currentId): AuthDeviceList => ({ devices: registry.list(currentId) }),
    attachPush: (deviceId, request): void => {
      registry.attachPush(deviceId, request.apnsToken, request.environment);
    },
  };
}

function createRevocationOps({ deps, retirement }: Parts): Pick<AuthService, "revoke" | "onRevoked"> {
  const { registry } = deps;
  return {
    async revoke(request): Promise<{ revoked: number }> {
      const revoked = registry.revoke(request.device);
      await retirement.retireWithWipe(revoked);
      return { revoked: revoked.length };
    },
    onRevoked: retirement.onRevoked,
  };
}

export function createAuthService(deps: AuthDeps): AuthService {
  const master = createMasterToken(deps.config.token);
  const now = deps.now;
  const identity = createNodeIdentity({ run: deps.run, commands: deps.tailscaleCommands, now, cacheMs: deps.whoisCacheMs, log: (line) => { deps.log.info(line); } });
  const tailnet = createTailnetGate({ identity, policy: deps.config.pairing, log: deps.log });
  const nodes = createCallerNodes(identity, deps.config.hubAddress);
  const parts = { deps, retirement: createRetirement(deps), master, nodes };
  const pairing = createPairOps({ deps, tailnet, master, issueLogin: issueLoginFor(deps) });
  return { ...createSessionOps(parts), ...createRevocationOps(parts), ...pairing, nodeCheckMs: deps.whoisCacheMs ?? WHOIS_CACHE_MS };
}
