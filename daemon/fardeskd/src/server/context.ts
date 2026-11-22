// Types and helpers shared by the app, the route modules and the stream.
import type { Context, Hono, Input } from "hono";
import type { IncomingMessage } from "node:http";
import { UNKNOWN_ADDRESS, peerAddressOf } from "./peerAddress.js";

/** What @hono/node-server hands every request as `c.env`. */
type NodeEnv = { incoming?: IncomingMessage; server?: { incoming?: IncomingMessage } };

export const PAIR_PATH = "/v1/auth/pair";
/** Pairing is the only route without a bearer, also addressed through any machine prefix: /m/<machine>/v1/auth/pair. */
const HUB_PUBLIC_PATH = /^\/m\/[^/]+(\/v1\/auth\/pair)$/;
export const isPublicAuthPath = (path: string): boolean => path === PAIR_PATH || HUB_PUBLIC_PATH.test(path);
export type AppEnv = { Variables: { deviceId: string; /** Set by a refused pairing: the caller's tailnet device name, for the audit line. */ peer: string } };
export type App = Hono<AppEnv>;

/** The peer address cached when the connection opened (#107); "unknown" is refused by the node check. */
export const clientIp = <P extends string, I extends Input>(c: Context<AppEnv, P, I>): string => {
  const env = c.env as NodeEnv | undefined;
  const incoming = (env?.server ?? env)?.incoming;
  return incoming === undefined ? UNKNOWN_ADDRESS : peerAddressOf(incoming.socket);
};
