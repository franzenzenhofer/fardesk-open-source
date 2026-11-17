// Types and helpers shared by the app, the route modules and the stream.
import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, Hono, Input } from "hono";

export const LOGIN_PATH = "/v1/auth/login";
export const PAIR_PATH = "/v1/auth/pair";
/** Login and pairing are the only routes without a bearer, also addressed through any machine prefix: /m/<machine>/v1/auth/login. */
const HUB_PUBLIC_PATH = /^\/m\/[^/]+(\/v1\/auth\/(?:login|pair))$/;
export const isPublicAuthPath = (path: string): boolean => path === LOGIN_PATH || path === PAIR_PATH || HUB_PUBLIC_PATH.test(path);
export type AppEnv = { Variables: { deviceId: string } };
export type App = Hono<AppEnv>;

export const clientIp = <P extends string, I extends Input>(c: Context<AppEnv, P, I>): string => getConnInfo(c).remote.address ?? "unknown";
