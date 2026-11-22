// A test daemon on every interface plus a (fake) Tailscale, reached through this computer's own network address: the
// caller is then not loopback, and the node it stands for is whatever the fake `tailscale whois` says it is.
import { networkInterfaces } from "node:os";
import { WebSocket } from "ws";
import { loginResultSchema, pairCodeResultSchema } from "../../src/contract/schema.js";
import type { LoginResult } from "../../src/contract/schema.js";
import { SELF_ADDRESS, createFakeTailscale } from "./fakeTailscale.js";
import type { FakeDevice, FakeTailscale } from "./fakeTailscale.js";
import { TEST_TOKEN, startTestDaemon } from "./daemon.js";
import type { TestDaemon } from "./daemon.js";

export const TAILNET = "example.ts.net";
export const OWNER = "owner@example.com";
export const SELF_STABLE_ID = "node-self";
const LOOPBACK = "127.0.0.1";

export const networkAddress: string | null = Object.values(networkInterfaces())
  .flatMap((list) => list ?? [])
  .find((entry) => entry.family === "IPv4" && !entry.internal)?.address ?? null;

export const phoneNode = (stableId: string): FakeDevice => ({ name: `phone.${TAILNET}.`, login: OWNER, stableId });

export type NetworkRig = { daemon: TestDaemon; tailscale: FakeTailscale; address: string };

/** The daemon listens on 0.0.0.0; the whois cache lives `whoisCacheMs`; this computer's node is `SELF_STABLE_ID`. */
export async function startNetworkRig(overrides: Record<string, unknown> = {}, whoisCacheMs = 60_000): Promise<NetworkRig> {
  const tailscale = createFakeTailscale(SELF_ADDRESS);
  tailscale.setDevice(SELF_ADDRESS, { name: `studio.${TAILNET}.`, login: OWNER, stableId: SELF_STABLE_ID });
  const daemon = await startTestDaemon(overrides, { tailscaleCommands: [tailscale.binary], whoisCacheMs }, { address: "0.0.0.0" });
  return { daemon, tailscale, address: networkAddress ?? LOOPBACK };
}

const urlOf = ({ daemon, address }: NetworkRig, path: string): string => `http://${address}:${daemon.config.bind.port}${path}`;

type Answer = { status: number; json: unknown };

async function send(rig: NetworkRig, path: string, init: RequestInit): Promise<Answer> {
  const response = await fetch(urlOf(rig, path), init);
  return { status: response.status, json: await response.json() };
}

export async function callFromNetwork(rig: NetworkRig, method: string, path: string, token: string): Promise<Answer> {
  return send(rig, path, { method, headers: { authorization: `Bearer ${token}` } });
}

/** Pairs a device the one way there is: a code minted with the master token (from loopback), redeemed from the network address. */
export async function pairFromNetwork(rig: NetworkRig, deviceName = "Test iPhone"): Promise<{ status: number; json: unknown }> {
  const code = pairCodeResultSchema.parse((await rig.daemon.call("POST", "/v1/auth/pair-code", undefined, TEST_TOKEN)).json).code;
  return send(rig, "/v1/auth/pair", { method: "POST", body: JSON.stringify({ code, deviceName }) });
}

export async function pairedTokenFromNetwork(rig: NetworkRig): Promise<LoginResult> {
  const result = await pairFromNetwork(rig);
  if (result.status !== 200) throw new Error(`pairing from the network address failed with ${result.status}`);
  return loginResultSchema.parse(result.json);
}

export function streamFromNetwork(rig: NetworkRig, token: string): WebSocket {
  return new WebSocket(urlOf(rig, "/v1/stream").replace("http", "ws"), { headers: { authorization: `Bearer ${token}` } });
}

/** Waits until the whois cache lifetime of the rig has passed. */
export const afterCacheExpiry = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
