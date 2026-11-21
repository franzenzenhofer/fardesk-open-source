// The auth facade: master token + device tokens, password login, revoke with wipe pushes, password change.
import type { z } from "zod";
import type { AuditLog } from "../audit/store.js";
import type { RunCommand } from "../config/bind.js";
import type { Config } from "../config/config.js";
import { loadConfig, writePasswordHash } from "../config/config.js";
import { WIPE_COMMAND } from "../contract/schema.js";
import type { AuthDeviceList, DeviceRequest, LoginRequest, LoginResult, logoutRequestSchema, Machine, PairCodeResult, PairRequest, PasswordChangeRequest, RevokeRequest } from "../contract/schema.js";
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
import { admitTailnetCaller, createTailnetGate } from "./tailnetCaller.js";
import type { TailnetGate } from "./tailnetCaller.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createLoginLimiter } from "./rateLimit.js";

const MS_PER_SECOND = 1000;
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
  log: Logger;
  audit: AuditLog;
  now: () => number;
};

export type AuthService = {
  authenticate: (token: string, ip: string) => Caller;
  login: (request: LoginRequest, ip: string) => Promise<LoginResult>;
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
  changePassword: (request: PasswordChangeRequest, ip: string) => Promise<void>;
  /** Re-reads `auth.passwordHash` from the config file and revokes every device token. */
  reload: () => Promise<void>;
  attachPush: (deviceId: string, request: DeviceRequest) => void;
  onRevoked: (listener: (deviceIds: string[]) => void) => () => void;
};

type Retirement = {
  closeSockets: (entries: DeviceEntry[]) => void;
  unregisterPush: (entries: DeviceEntry[]) => void;
  retireWithWipe: (entries: DeviceEntry[]) => Promise<void>;
  onRevoked: AuthService["onRevoked"];
};

type PasswordGate = { admitCaller: (ip: string) => Promise<void>; check: (password: string, ip: string) => Promise<number>; requireCurrent: (revision: number) => void; replaceHash: (hash: string | null) => void };

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

const changedPassword = (): FardeskError => new FardeskError("unauthorized", "password changed during authentication");

function createPasswordGate({ config, now }: AuthDeps, tailnet: TailnetGate): PasswordGate {
  const limiter = createLoginLimiter({ maxFailures: config.auth.maxFailures, windowMs: config.auth.windowSeconds * MS_PER_SECOND, now });
  let passwordHash = config.auth.passwordHash;
  let revision = 0;
  const requireCurrent = (checked: number): void => { if (checked !== revision) throw changedPassword(); };
  return {
    requireCurrent,
    async admitCaller(ip): Promise<void> { await admitTailnetCaller(limiter, tailnet, ip); },
    replaceHash(hash): void { passwordHash = hash; revision += 1; },
    async check(password, ip): Promise<number> {
      if (passwordHash === null) throw new FardeskError("unsupported", "no password set: run fardeskd set-password");
      const release = limiter.reserve(ip);
      const checked = revision;
      try {
        const matches = await verifyPassword(password, passwordHash);
        requireCurrent(checked);
        if (!matches) {
          limiter.recordFailure(ip);
          throw new FardeskError("unauthorized", "wrong password");
        }
        limiter.recordSuccess(ip);
        return checked;
      } finally {
        release();
      }
    },
  };
}


type Parts = { deps: AuthDeps; gate: PasswordGate; retirement: Retirement; master: MasterToken };

function issueLoginFor(deps: AuthDeps): (deviceName: string, ip: string) => LoginResult {
  return (deviceName, ip) => {
    const { token, device } = deps.registry.issue(deviceName, ip);
    deps.log.info("device_logged_in", { deviceId: device.id });
    return { token, deviceId: device.id, machine: deps.machine(), peers: deps.config.peers };
  };
}

function createSessionOps({ deps, gate, retirement, master }: Parts): Pick<AuthService, "authenticate" | "login" | "logout" | "devices" | "attachPush"> {
  const { registry } = deps;
  const issueLogin = issueLoginFor(deps);
  return {
    authenticate(token, ip): Caller {
      if (master.matches(token)) return { state: "ok", deviceId: MASTER_DEVICE_ID };
      const result = registry.authenticate(token, ip);
      return result.state === "ok" ? { state: "ok", deviceId: result.device.id } : result;
    },
    async login(request, ip): Promise<LoginResult> {
      await gate.admitCaller(ip);
      gate.requireCurrent(await gate.check(request.password, ip));
      return issueLogin(request.deviceName, ip);
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

function createRevocationOps({ deps, gate, retirement }: Parts): Pick<AuthService, "revoke" | "changePassword" | "reload" | "onRevoked"> {
  const { registry } = deps;
  return {
    async revoke(request): Promise<{ revoked: number }> {
      const revoked = registry.revoke(request.device);
      await retirement.retireWithWipe(revoked);
      return { revoked: revoked.length };
    },
    async changePassword(request, ip): Promise<void> {
      const checked = await gate.check(request.current, ip);
      const hash = await hashPassword(request.next);
      gate.requireCurrent(checked);
      writePasswordHash(deps.configPath, hash);
      gate.replaceHash(hash);
      await retirement.retireWithWipe(registry.revokeAll());
    },
    async reload(): Promise<void> {
      gate.replaceHash(loadConfig(deps.configPath).auth.passwordHash);
      await retirement.retireWithWipe(registry.revokeAll());
    },
    onRevoked: retirement.onRevoked,
  };
}

export function createAuthService(deps: AuthDeps): AuthService {
  const master = createMasterToken(deps.config.token);
  const tailnet = createTailnetGate({ run: deps.run, commands: deps.tailscaleCommands, policy: deps.config.pairing, log: deps.log });
  const parts = { deps, gate: createPasswordGate(deps, tailnet), retirement: createRetirement(deps), master };
  const pairing = createPairOps({ deps, tailnet, master, issueLogin: issueLoginFor(deps) });
  return { ...createSessionOps(parts), ...createRevocationOps(parts), ...pairing };
}
