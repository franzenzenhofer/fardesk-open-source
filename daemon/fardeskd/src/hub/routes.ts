// GET /v1/hub and /m/<machine>/...: the local app for this machine and for /v1/auth/*, cache or forward for a peer.
import type { Context } from "hono";
import type { Config } from "../config/config.js";
import type { App, AppEnv } from "../server/context.js";
import { serveFromCache } from "./cached.js";
import { decodeMachine, knownPeer, requireOnline } from "./guard.js";
import type { Hub } from "./hub.js";
import type { PeerMonitor } from "./monitor.js";

const SHORT_TIMEOUT_MS = 15_000;
const LONG_TIMEOUT_MS = 120_000;
// /compact waits up to 180 s for the compact boundary, plus a resume of an ended session first.
const COMPACT_TIMEOUT_MS = 240_000;
const LONG_ACTIONS = /\/(new|resume|takeover|fork|clear|attachments)$/;
// Login and logout are about the caller's session with the hub itself (the peer token belongs to the hub, not to the
// phone); the other /v1/auth/* routes (devices, revoke, password, reload) are about the machine that is addressed.
const HUB_OWN_AUTH = new Set(["/v1/auth/login", "/v1/auth/logout"]);
const DEVICES_PATH = "/v1/devices";
const DROPPED_HEADERS = new Set(["authorization", "host", "content-length", "connection", "transfer-encoding", "accept-encoding"]);

type Target = { name: string; path: string; search: string; body: ArrayBuffer | undefined };
type Ctx = Context<AppEnv>;

function parseTarget(url: URL, body: ArrayBuffer | undefined): Target {
  const [, , raw = "", ...rest] = url.pathname.split("/");
  return { name: decodeMachine(raw), path: `/${rest.join("/")}`, search: url.search, body };
}

async function bodyOf(c: Ctx): Promise<ArrayBuffer | undefined> {
  return c.req.method === "GET" || c.req.method === "HEAD" ? undefined : c.req.arrayBuffer();
}

async function local(app: App, c: Ctx, target: Target): Promise<Response> {
  const request = new Request(`${new URL(c.req.url).origin}${target.path}${target.search}`, {
    method: c.req.method,
    headers: c.req.raw.headers,
    ...(target.body === undefined ? {} : { body: target.body }),
  });
  return app.fetch(request, c.env);
}

function forwardHeaders(c: Ctx): Record<string, string> {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => { if (!DROPPED_HEADERS.has(key)) headers[key] = value; });
  return headers;
}

function timeoutFor(path: string): number {
  if (path.endsWith("/compact")) return COMPACT_TIMEOUT_MS;
  return LONG_ACTIONS.test(path) ? LONG_TIMEOUT_MS : SHORT_TIMEOUT_MS;
}

async function forward(peer: PeerMonitor, c: Ctx, target: Target): Promise<Response> {
  const timeoutMs = timeoutFor(target.path);
  const response = await peer.call({ method: c.req.method, path: `${target.path}${target.search}`, headers: forwardHeaders(c), body: target.body, timeoutMs });
  const contentType = response.headers.get("content-type");
  return new Response(await response.arrayBuffer(), { status: response.status, headers: contentType === null ? {} : { "content-type": contentType } });
}

type Handler = { app: App; hub: Hub; config: Config };

async function viaPeer({ app, hub, config }: Handler, c: Ctx, target: Target): Promise<Response> {
  const peer = knownPeer(hub, target.name);
  if (c.req.method === "POST" && target.path === DEVICES_PATH) {
    const own = await local(app, c, target);
    if (!own.ok) return own;
  }
  requireOnline(peer);
  const search = new URL(c.req.url).searchParams;
  if (c.req.method === "GET") {
    const cached = await serveFromCache(peer, target.path, search, config.activityPageLimit);
    if (cached !== null) return cached;
  }
  return forward(peer, c, target);
}

async function handle(handler: Handler, c: Ctx): Promise<Response> {
  const target = parseTarget(new URL(c.req.url), await bodyOf(c));
  if (target.name === handler.config.name || HUB_OWN_AUTH.has(target.path)) return local(handler.app, c, target);
  return viaPeer(handler, c, target);
}

export function registerHubRoutes(app: App, hub: Hub, config: Config): void {
  app.get("/v1/hub", (c) => c.json(hub.state()));
  app.all("/m/:machine/*", async (c) => handle({ app, hub, config }, c));
}
