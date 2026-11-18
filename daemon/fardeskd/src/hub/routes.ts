// GET /v1/hub and /m/<machine>/...: the local app for this machine and for /v1/auth/*, cache or forward for a peer.
import type { Context } from "hono";
import { MAX_ATTACHMENT_BYTES } from "../attachments/store.js";
import { MASTER_DEVICE_ID } from "../auth/deviceRegistry.js";
import { FardeskError } from "../core/errors.js";
import { PAIR_PATH } from "../server/context.js";
import { MAX_JSON_BYTES, readBoundedBody } from "../server/boundedBody.js";
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
// Device callers may only forward peer auth operations available to ordinary devices.
const DEVICE_PEER_AUTH = new Set([PAIR_PATH, "/v1/auth/devices", "/v1/auth/revoke", "/v1/auth/password", "/v1/auth/reload"]);
const DEVICES_PATH = "/v1/devices";
const DROPPED_HEADERS = new Set(["authorization", "host", "content-length", "connection", "transfer-encoding", "accept-encoding"]);

type Target = { name: string; path: string; search: string; body: Uint8Array<ArrayBuffer> | undefined };
type Ctx = Context<AppEnv>;

function parseTarget(url: URL): Omit<Target, "body"> {
  const [, , raw = "", ...rest] = url.pathname.split("/");
  return { name: decodeMachine(raw), path: `/${rest.join("/")}`, search: url.search };
}

async function bodyOf(c: Ctx, path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  if (c.req.method === "GET" || c.req.method === "HEAD") return undefined;
  const attachment = c.req.method === "POST" && /^\/v1\/sessions\/[^/]+\/attachments$/.test(path);
  return readBoundedBody(c.req.raw, attachment ? MAX_ATTACHMENT_BYTES : MAX_JSON_BYTES, attachment);
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

/** The peer behind a public (bearer-less) pairing request: unknown and offline machines answer without naming any machine. */
function anonymousPeer(hub: Hub, name: string): PeerMonitor {
  try {
    const peer = knownPeer(hub, name);
    requireOnline(peer);
    return peer;
  } catch (error) {
    if (error instanceof FardeskError) throw new FardeskError(error.code, "no such machine is available");
    throw error;
  }
}

async function viaPeer({ app, hub, config }: Handler, c: Ctx, target: Target): Promise<Response> {
  const caller = c.get("deviceId") as string | undefined;
  if (caller !== MASTER_DEVICE_ID && /^\/+v1\/+auth(?:\/|$)/i.test(decodeMachine(target.path)) && !DEVICE_PEER_AUTH.has(target.path)) {
    throw new FardeskError("unauthorized", "the hub master token is required for this peer operation");
  }
  const peer = caller === undefined ? anonymousPeer(hub, target.name) : knownPeer(hub, target.name);
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
  const route = parseTarget(new URL(c.req.url));
  const target = { ...route, body: await bodyOf(c, route.path) };
  if (target.name === handler.config.name || HUB_OWN_AUTH.has(target.path)) return local(handler.app, c, target);
  return viaPeer(handler, c, target);
}

export function registerHubRoutes(app: App, hub: Hub, config: Config): void {
  app.get("/v1/hub", (c) => c.json(hub.state()));
  app.all("/m/:machine/*", async (c) => handle({ app, hub, config }, c));
}
