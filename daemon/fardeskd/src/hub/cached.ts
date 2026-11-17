// Answers GET /v1/machine, /v1/sessions and the newest activity page of a session from the hub's cache.
import { activityPageSchema } from "../contract/schema.js";
import type { PeerMonitor } from "./monitor.js";
import { MAX_CACHED_ROWS } from "./cache.js";

const ACTIVITY_PATH = /^\/v1\/sessions\/([^/]+)\/activity$/;
const FETCH_TIMEOUT_MS = 15_000;

export type PageLimits = { default: number; max: number };

const json = (body: unknown): Response => Response.json(body);

function requestedLimit(search: URLSearchParams, limits: PageLimits): number | null {
  for (const key of search.keys()) if (key !== "limit") return null;
  const raw = search.get("limit");
  if (raw === null) return limits.default;
  const limit = Number(raw);
  return Number.isInteger(limit) && limit > 0 ? Math.min(limit, limits.max) : null;
}

async function activityFromPeer(peer: PeerMonitor, sessionId: string, limit: number): Promise<Response> {
  const path = `/v1/sessions/${sessionId}/activity`;
  const fetchLimit = Math.min(limit, MAX_CACHED_ROWS);
  const response = await peer.call({ method: "GET", path: `${path}?limit=${fetchLimit}`, timeoutMs: FETCH_TIMEOUT_MS });
  if (!response.ok) return response;
  peer.cache.seed(decodeURIComponent(sessionId), activityPageSchema.parse(await response.json()));
  return json(peer.cache.page(decodeURIComponent(sessionId), limit));
}

async function activity(peer: PeerMonitor, sessionId: string, search: URLSearchParams, limits: PageLimits): Promise<Response | null> {
  const limit = requestedLimit(search, limits);
  if (limit === null) return null;
  const page = peer.cache.page(decodeURIComponent(sessionId), limit);
  return page === null ? activityFromPeer(peer, sessionId, limit) : json(page);
}

/** The cached answer for a GET, or null when this request has to go to the peer. */
export async function serveFromCache(peer: PeerMonitor, path: string, search: URLSearchParams, limits: PageLimits): Promise<Response | null> {
  if (!peer.streamLive()) return null;
  const machine = peer.cache.machine();
  if (path === "/v1/machine") return machine === null ? null : json(machine);
  if (path === "/v1/sessions") return json(peer.cache.sessions());
  const match = ACTIVITY_PATH.exec(path);
  return match?.[1] === undefined ? null : activity(peer, match[1], search, limits);
}
