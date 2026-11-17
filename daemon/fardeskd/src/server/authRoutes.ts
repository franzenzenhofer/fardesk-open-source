// /v1/auth/*: login and pair (the only routes without a bearer), pair-code, rotate-token, logout, devices, revoke, password change, reload.
import {
  loginRequestSchema,
  logoutRequestSchema,
  pairRequestSchema,
  passwordChangeRequestSchema,
  revokeRequestSchema,
} from "../contract/schema.js";
import type { Services } from "../service/types.js";
import { LOGIN_PATH, PAIR_PATH, clientIp } from "./context.js";
import type { App } from "./context.js";
import { parseBody } from "./validate.js";

const OK = { ok: true } as const;

export function registerAuthRoutes(app: App, services: Services): void {
  const { auth } = services;
  app.post(LOGIN_PATH, async (c) => c.json(await auth.login(await parseBody(c, loginRequestSchema), clientIp(c))));
  app.post(PAIR_PATH, async (c) => c.json(auth.pair(await parseBody(c, pairRequestSchema), clientIp(c))));
  app.post("/v1/auth/pair-code", (c) => c.json(auth.issuePairCode(c.get("deviceId"))));
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
