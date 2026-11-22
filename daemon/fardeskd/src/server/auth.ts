// Bearer-token check shared by the HTTP routes and the WebSocket upgrade.
import { FardeskError } from "../core/errors.js";
import type { AuthService } from "../auth/service.js";

const BEARER_PREFIX = "Bearer ";

export const bearerToken = (header: string | undefined): string => (header?.startsWith(BEARER_PREFIX) === true ? header.slice(BEARER_PREFIX.length) : "");

/** Returns the id of the calling device (`master` for the pairing token) or throws 401 `unauthorized` / `token_revoked`. */
export async function requireCaller(auth: AuthService, header: string | undefined, ip: string, fresh = false): Promise<string> {
  const caller = await auth.authenticate(bearerToken(header), ip, fresh);
  if (caller.state === "ok") return caller.deviceId;
  if (caller.state === "revoked") throw new FardeskError("token_revoked", "this device token was revoked");
  throw new FardeskError("unauthorized", "missing or wrong bearer token");
}
