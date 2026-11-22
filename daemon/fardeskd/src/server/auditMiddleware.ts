// One audit line for every state-changing request and every rejected pairing (no message text).
import type { MiddlewareHandler } from "hono";
import { routePath } from "hono/route";
import type { AuditLog } from "../audit/store.js";
import { clientIp, isPublicAuthPath } from "./context.js";
import type { AppEnv } from "./context.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SESSION_PATH = /^\/(?:m\/[^/]+\/)?v1\/sessions\/([^/]+)/;
const FAILED = 400;
const UNMATCHED = "(unmatched)";

export function auditMiddleware(audit: AuditLog): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    await next();
    const method = c.req.method;
    const failedAuth = isPublicAuthPath(c.req.path) && c.res.status >= FAILED;
    if (READ_METHODS.has(method) && !failedAuth) return;
    const caller = c.get("deviceId") as string | undefined;
    const peer = c.get("peer") as string | undefined;
    audit.record({
      event: failedAuth ? "pairing_failed" : "request",
      deviceId: caller ?? null,
      method,
      route: routePath(c, -1) || UNMATCHED,
      sessionId: SESSION_PATH.exec(c.req.path)?.[1] ?? null,
      result: c.res.status,
      ip: clientIp(c),
      ...(peer === undefined ? {} : { peer }),
    });
  };
}
