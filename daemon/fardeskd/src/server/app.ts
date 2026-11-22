// The Hono app: bearer auth for everything but pairing, the audit log, the routes, one error handler, JSON 404.
import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FardeskError, HTTP_STATUS } from "../core/errors.js";
import type { Config } from "../config/config.js";
import { createLogger, stderrSink } from "../core/log.js";
import type { Hub } from "../hub/hub.js";
import { hubRouteHooks } from "../hub/devices.js";
import { registerHubRoutes } from "../hub/routes.js";
import { registerUpdateAllRoute } from "../hub/updateRoute.js";
import type { Logger } from "../core/log.js";
import type { Services } from "../service/types.js";
import { requireCaller } from "./auth.js";
import { auditMiddleware } from "./auditMiddleware.js";
import { clientIp, isPublicAuthPath } from "./context.js";
import type { App, AppEnv } from "./context.js";
import { errorBody } from "./errorBody.js";
import { registerRoutes } from "./routes.js";

export type HubWiring = { hub: Hub; config: Config };

export function createApp(services: Services, log?: Logger, hub?: HubWiring | null): App {
  const logger = log ?? createLogger(stderrSink, () => new Date());
  const app = new Hono<AppEnv>();
  app.use("*", auditMiddleware(services.audit));
  app.use("*", async (c, next) => {
    if (c.req.method === "POST" && isPublicAuthPath(c.req.path)) return next();
    c.set("deviceId", await requireCaller(services.auth, c.req.header("authorization"), clientIp(c)));
    return next();
  });
  registerRoutes(app, services, hub === undefined || hub === null ? {} : hubRouteHooks(hub.hub));
  if (hub !== undefined && hub !== null) {
    registerHubRoutes(app, hub.hub, hub.config, services.auth);
    registerUpdateAllRoute(app, services, hub.config);
  }
  app.notFound((c) => c.json(errorBody("not_found", `no route ${c.req.method} ${c.req.path}`), 404));
  app.onError((error, c) => {
    if (error instanceof FardeskError) return c.json(errorBody(error.code, error.message), HTTP_STATUS[error.code] as ContentfulStatusCode);
    logger.error("request_failed", { path: c.req.path, error: error.name });
    return c.json(errorBody("internal", "internal error"), 500);
  });
  return app;
}
