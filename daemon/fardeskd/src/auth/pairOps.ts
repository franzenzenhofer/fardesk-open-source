// Pairing codes and master-token rotation: the auth operations that do not depend on the password.
import { updateConfigFile } from "../config/config.js";
import type { LoginResult, PairCodeResult, PairRequest } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { MASTER_DEVICE_ID } from "./deviceRegistry.js";
import { newMasterToken } from "./masterToken.js";
import type { MasterToken } from "./masterToken.js";
import { createPairCodes } from "./pairCodes.js";
import { createLoginLimiter } from "./rateLimit.js";
import type { AuthDeps } from "./service.js";

const MS_PER_SECOND = 1000;

export type PairOps = {
  /** Master token only. */
  issuePairCode: (callerId: string) => PairCodeResult;
  pair: (request: PairRequest, ip: string) => LoginResult;
  /** Master token only. Writes a new master token to the config file and starts using it; device tokens stay valid. */
  rotateToken: (callerId: string) => void;
};

type PairParts = { deps: AuthDeps; master: MasterToken; issueLogin: (deviceName: string, ip: string) => LoginResult };

function requireMaster(callerId: string, what: string): void {
  if (callerId !== MASTER_DEVICE_ID) throw new FardeskError("unauthorized", `only the master token can ${what}`);
}

export function createPairOps({ deps, master, issueLogin }: PairParts): PairOps {
  const { config, now } = deps;
  const codes = createPairCodes(now);
  const limiter = createLoginLimiter({ maxFailures: config.auth.maxFailures, windowMs: config.auth.windowSeconds * MS_PER_SECOND, now });
  return {
    issuePairCode(callerId): PairCodeResult {
      requireMaster(callerId, "create pairing codes");
      return codes.issue();
    },
    pair(request, ip): LoginResult {
      limiter.check(ip);
      if (!codes.redeem(request.code)) {
        limiter.recordFailure(ip);
        throw new FardeskError("unauthorized", "pairing code is wrong, already used or expired");
      }
      limiter.recordSuccess(ip);
      return issueLogin(request.deviceName, ip);
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
