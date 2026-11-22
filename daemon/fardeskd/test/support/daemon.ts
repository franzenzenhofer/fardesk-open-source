// A whole real daemon for tests: temp Claude home, real services, real plain HTTP server on 127.0.0.1.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import { configSchema } from "../../src/config/config.js";
import type { Config } from "../../src/config/config.js";
import type { StreamEvent } from "../../src/contract/schema.js";
import { streamEventSchema } from "../../src/contract/schema.js";
import { createLogger } from "../../src/core/log.js";
import { startHub } from "../../src/hub/hub.js";
import { createStreamRouter } from "../../src/hub/relay.js";
import { createApp } from "../../src/server/app.js";
import { startServer } from "../../src/server/listen.js";
import type { ListenOptions, RunningServer } from "../../src/server/listen.js";
import { createRealOwned } from "../../src/service/ownedFactory.js";
import { createServices } from "../../src/service/services.js";
import type { ServiceOptions, Services } from "../../src/service/types.js";
import { createClaudeHome } from "./claudeHome.js";
import type { ClaudeHome } from "./claudeHome.js";
import { freePort, makeTempDir } from "./env.js";
import { createFakeOsascript } from "./fakeOsascript.js";
import { writeWrapper } from "./terminals.js";

export const TEST_TOKEN = "k".repeat(48);

export type TestDaemon = {
  home: ClaudeHome;
  config: Config;
  services: Services;
  server: RunningServer;
  url: string;
  /** A request to the daemon (path starts with /). */
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** A WebSocket to `path` (starts with /); the caller attaches the listeners. */
  connectStream(path: string, headers: Record<string, string>): WebSocket;
  call(method: string, path: string, body?: unknown, token?: string | null): Promise<{ status: number; json: unknown }>;
  openStream(token?: string): Promise<TestStream>;
  close(): Promise<void>;
};

export type TestStream = { ws: WebSocket; events: StreamEvent[]; close(): void };

type ConfigOverrides = Record<string, unknown>;

export function testConfig(home: ClaudeHome, port: number, overrides: ConfigOverrides = {}): Config {
  return configSchema.parse({
    name: "test-mac",
    token: TEST_TOKEN,
    bind: { address: "127.0.0.1", port },
    claudeHomes: [home.dir],
    stateDir: makeTempDir("fds-"),
    intervals: { registryPollMs: 100, transcriptPollMs: 50, pingMs: 60_000 },
    permissionTimeoutSeconds: 60,
    // Fixture sessions name invented folders: show their ended sessions anyway.
    sessions: { tidyList: false },
    // Hermetic: never the real tmux servers or the real osascript of the person running the tests (see src/core/sandbox.ts).
    tmuxBinary: writeWrapper().binary,
    osascriptBinary: createFakeOsascript().binary,
    delivery: { timeoutMs: 2000, pollMs: 50 },
    kill: { timeoutMs: 3000, pollMs: 50 },
    ...overrides,
  });
}

// Writes the (already validated) config where the daemon expects its config file: <stateDir>/config.json.
export function writeConfigFile(config: Config): string {
  const path = join(config.stateDir, "config.json");
  mkdirSync(config.stateDir, { recursive: true });
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  return path;
}

export async function openTestStream(url: string, token: string): Promise<TestStream> {
  const ws = new WebSocket(`${url.replace("http", "ws")}/v1/stream`, { headers: { authorization: `Bearer ${token}` } });
  const events: StreamEvent[] = [];
  ws.on("message", (data: Buffer) => { events.push(streamEventSchema.parse(JSON.parse(data.toString()))); });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => { resolve(); });
    ws.once("error", reject);
  });
  return { ws, events, close: (): void => { ws.close(); } };
}

type ApiCall = { url: string; method: string; path: string; body: unknown; token: string | null };

async function callApi({ url, method, path, body, token }: ApiCall): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = token === null ? {} : { authorization: `Bearer ${token}` };
  const init: RequestInit = { method, headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) };
  const response = await fetch(`${url}${path}`, init);
  return { status: response.status, json: await response.json() };
}

function trackStreams(url: string): { open(token?: string): Promise<TestStream>; closeAll(): void } {
  const streams: TestStream[] = [];
  return {
    async open(token = TEST_TOKEN): Promise<TestStream> {
      const stream = await openTestStream(url, token);
      streams.push(stream);
      return stream;
    },
    closeAll(): void {
      for (const stream of streams) stream.close();
    },
  };
}

function testServiceDefaults(config: Config): ServiceOptions {
  return { createOwned: createRealOwned, configPath: writeConfigFile(config), log: createLogger(() => undefined, () => new Date()) };
}

// The client side of a test daemon: call, fetch, connectStream and openStream.
function testClient(url: string): { api: Pick<TestDaemon, "call" | "fetch" | "connectStream" | "openStream">; closeStreams(): void } {
  const streams = trackStreams(url);
  // A test may start a call, wait for something else and only then await it. If that wait times out, the call is
  // never awaited and fails later against the closed daemon as an unhandled rejection that breaks the whole run.
  // The extra catch marks the promise as observed; whoever awaits it still gets the failure.
  const call: TestDaemon["call"] = (method, path, body, token = TEST_TOKEN) => {
    const pending = callApi({ url, method, path, body, token });
    pending.catch(() => undefined);
    return pending;
  };
  return {
    closeStreams: (): void => { streams.closeAll(); },
    api: {
      call,
      fetch: async (path, init) => fetch(`${url}${path}`, init),
      connectStream: (path, headers) => new WebSocket(`${url.replace("http", "ws")}${path}`, { headers }),
      openStream: async (token) => streams.open(token),
    },
  };
}

export async function startTestDaemon(
  overrides: ConfigOverrides = {},
  options: Partial<ServiceOptions> = {},
  listenOverrides: Partial<ListenOptions> = {},
): Promise<TestDaemon> {
  const home = createClaudeHome();
  const port = await freePort();
  const config = testConfig(home, port, overrides);
  const services = await createServices(config, { ...testServiceDefaults(config), ...options });
  const hub = startHub(config, services);
  const streamRouter = hub === null ? {} : { streamRouter: createStreamRouter(hub) };
  const listen = { address: "127.0.0.1", port, pingMs: 60_000, ...streamRouter, ...listenOverrides };
  const server = await startServer(createApp(services, undefined, hub === null ? null : { hub, config }), listen, services.bus, services);
  const url = `http://127.0.0.1:${port}`;
  const client = testClient(url);
  const close = async (): Promise<void> => {
    client.closeStreams();
    hub?.close();
    await server.close();
    await services.close();
    home.dispose();
  };
  return { home, config, services, server, url, ...client.api, close };
}

export const hookSocket = (daemon: TestDaemon): string => join(daemon.config.stateDir, "hook.sock");
