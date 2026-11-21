// Pairing codes and master-token rotation: the auth operations that do not depend on the password.
import { updateConfigFile } from "../config/config.js";
import type { LoginResult, PairCodeResult, PairRequest } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { PAIR_PATH } from "../server/context.js";
import { MASTER_DEVICE_ID } from "./deviceRegistry.js";
import { newMasterToken } from "./masterToken.js";
import type { MasterToken } from "./masterToken.js";
import { PAIR_MAX_WRONG, createPairWindow } from "./pairCodes.js";
import type { PairWindow, PairWindowStatus } from "./pairCodes.js";
import { createLoginLimiter } from "./rateLimit.js";
import type { AuthDeps } from "./service.js";
import { admitTailnetCaller } from "./tailnetCaller.js";
import type { TailnetGate } from "./tailnetCaller.js";

const MS_PER_SECOND = 1000;
const LOCKED_STATUS = 429;

export type PairOps = {
  /** Master token only. */
  openPairWindow: (callerId: string) => PairCodeResult;
  /** Master token only. Where the window of this code (its window id) stands; asking keeps an open window open. */
  pairWindowStatus: (callerId: string, windowId: string) => PairWindowStatus;
  /** Master token only. Closes the window of this code at once (what `fardeskd pair` does when it ends). */
  closePairWindow: (callerId: string, windowId: string) => void;
  /** Refuses (403, audited) a caller that Tailscale does not show as the same tailnet user as this computer, then redeems the code. */
  pair: (request: PairRequest, ip: string) => Promise<LoginResult>;
  /** Only the who-is-calling check of `pair` (rate limit + tailnet gate), for a hub that forwards a pairing request to a peer. */
  verifyPairingCaller: (ip: string) => Promise<void>;
  /** Master token only. Writes a new master token to the config file and starts using it; device tokens stay valid. */
  rotateToken: (callerId: string) => void;
};

type PairParts = { deps: AuthDeps; tailnet: TailnetGate; master: MasterToken; issueLogin: (deviceName: string, ip: string) => LoginResult };

function requireMaster(callerId: string, what: string): void {
  if (callerId !== MASTER_DEVICE_ID) throw new FardeskError("unauthorized", `only the master token can ${what}`);
}

type PairGuards = { window: PairWindow; gate: TailnetGate; limiter: ReturnType<typeof createLoginLimiter> };

function createGuards({ config, now }: AuthDeps, gate: TailnetGate): PairGuards {
  return {
    window: createPairWindow(now),
    gate,
    limiter: createLoginLimiter({ maxFailures: config.auth.maxFailures, windowMs: config.auth.windowSeconds * MS_PER_SECOND, now }),
  };
}

const WRONG_MESSAGE = "pairing code is wrong, already used or expired";
const CLOSED_MESSAGE = "no pairing window is open: run fardeskd pair on this computer and keep it running";
const LOCKED_MESSAGE = `pairing window closed after ${PAIR_MAX_WRONG} wrong codes`;

/** Rate limit, then who is calling (before the code is touched, so a refused device cannot burn it), then the code. Returns the caller's tailnet device. */
async function admitPairing({ window, gate, limiter }: PairGuards, { audit }: AuthDeps, request: PairRequest, ip: string): Promise<string | null> {
  const device = await admitTailnetCaller(limiter, gate, ip);
  const result = window.redeem(request.code);
  if (result === "ok") {
    limiter.recordSuccess(ip);
    return device;
  }
  limiter.recordFailure(ip);
  if (result === "locked") {
    audit.record({ event: "pairing_locked", deviceId: null, method: "POST", route: PAIR_PATH, sessionId: null, result: LOCKED_STATUS, ip, ...(device === null ? {} : { peer: device }) });
    throw new FardeskError("rate_limited", LOCKED_MESSAGE);
  }
  throw new FardeskError("unauthorized", result === "no_window" ? CLOSED_MESSAGE : WRONG_MESSAGE);
}

function windowOps(window: PairWindow): Pick<PairOps, "openPairWindow" | "pairWindowStatus" | "closePairWindow"> {
  return {
    openPairWindow(callerId): PairCodeResult {
      requireMaster(callerId, "open the pairing window");
      return window.open();
    },
    pairWindowStatus(callerId, windowId): PairWindowStatus {
      requireMaster(callerId, "read the pairing window");
      return window.status(windowId);
    },
    closePairWindow(callerId, windowId): void {
      requireMaster(callerId, "close the pairing window");
      window.close(windowId);
    },
  };
}

export function createPairOps({ deps, tailnet, master, issueLogin }: PairParts): PairOps {
  const guards = createGuards(deps, tailnet);
  return {
    ...windowOps(guards.window),
    async verifyPairingCaller(ip): Promise<void> {
      await admitTailnetCaller(guards.limiter, guards.gate, ip);
    },
    async pair(request, ip): Promise<LoginResult> {
      const tailnetDevice = await admitPairing(guards, deps, request, ip);
      const login = issueLogin(request.deviceName, ip);
      guards.window.paired({ deviceName: request.deviceName, deviceId: login.deviceId, tailnetDevice });
      return login;
    },
    rotateToken(callerId): void {
      requireMaster(callerId, "rotate the master token");
      const token = newMasterToken();
      updateConfigFile(deps.configPath, { token });
      master.replace(token);
      deps.log.info("master_token_rotated");
    },
  };
}
