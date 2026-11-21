// /v1/auth/*: login and pair (the only routes without a bearer), pair-code, pair-window, rotate-token, logout, devices, revoke, password change, reload.
import {
  loginRequestSchema,
  logoutRequestSchema,
  pairRequestSchema,
  passwordChangeRequestSchema,
  revokeRequestSchema,
} from "../contract/schema.js";
import { PairingRefused } from "../auth/tailnetCaller.js";
import { FardeskError } from "../core/errors.js";
import type { Services } from "../service/types.js";
import { LOGIN_PATH, PAIR_PATH, clientIp } from "./context.js";
import type { Context } from "hono";
import type { App, AppEnv } from "./context.js";
import { parseBody } from "./validate.js";

const OK = { ok: true } as const;

/** A refused pairing or login hands the caller's tailnet device name to the audit middleware, then fails as before. */
export const rememberPeer = (c: Context<AppEnv>) => (error: unknown): never => {
  if (error instanceof PairingRefused && error.device !== null) c.set("peer", error.device);
  throw error;
};

const WINDOW_ID = /^[0-9a-f]{64}$/;

/** The `window` query parameter: the id of a pairing window (hex SHA-256 of its code). */
function windowParam(c: Context<AppEnv>): string {
  const id = c.req.query("window") ?? "";
  if (!WINDOW_ID.test(id)) throw new FardeskError("invalid_request", "window must be the 64 hex characters of the pairing window id");
  return id;
}

export function registerAuthRoutes(app: App, services: Services): void {
  const { auth } = services;
  app.post(LOGIN_PATH, async (c) => c.json(await auth.login(await parseBody(c, loginRequestSchema), clientIp(c)).catch(rememberPeer(c))));
  app.post(PAIR_PATH, async (c) => c.json(await auth.pair(await parseBody(c, pairRequestSchema), clientIp(c)).catch(rememberPeer(c))));
  app.post("/v1/auth/pair-code", (c) => c.json(auth.openPairWindow(c.get("deviceId"))));
  app.get("/v1/auth/pair-window", (c) => c.json(auth.pairWindowStatus(c.get("deviceId"), windowParam(c))));
  app.post("/v1/auth/pair-window/close", (c) => {
    auth.closePairWindow(c.get("deviceId"), windowParam(c));
    return c.json(OK);
  });
  app.post("/v1/auth/rotate-token", (c) => {
    auth.rotateToken(c.get("deviceId"));
    return c.json(OK);
  });
  app.post("/v1/auth/logout", async (c) => {
    auth.logout(c.get("deviceId"), await parseBody(c, logoutRequestSchema));
    return c.json(OK);
  });
  app.get("/v1/auth/devices", (c) => c.json(auth.devices(c.get("deviceId"))));
  app.post("/v1/auth/revoke", async (c) => c.json(await auth.revoke(await parseBody(c, revokeRequestSchema))));
  app.post("/v1/auth/password", async (c) => {
    await auth.changePassword(await parseBody(c, passwordChangeRequestSchema), clientIp(c));
    return c.json(OK);
  });
  app.post("/v1/auth/reload", async (c) => {
    await auth.reload();
    return c.json(OK);
  });
}
