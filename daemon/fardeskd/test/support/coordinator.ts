// Two real daemons for the coordinator tests: `peer` is a second fardeskd, `local` links to it.
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterAll, beforeAll } from "vitest";
import { createCoordinatorBackend } from "../../src/coordinator/backend.js";
import { coordinatorTools } from "../../src/coordinator/tools.js";
import type { CoordinatorBackend } from "../../src/coordinator/types.js";
import { freePort, waitUntil } from "./env.js";
import { startTestDaemon, TEST_TOKEN } from "./daemon.js";
import type { TestDaemon } from "./daemon.js";

export const LOCAL_NAME = "local-mac";
export const PEER_NAME = "peer-mac";
export const UNLINKED_NAME = "unlinked-box";
export const DOWN_NAME = "down-box";
export const BROKEN_NAME = "broken-box";

export type LinkedPair = {
  local: TestDaemon;
  peer: TestDaemon;
  localSessionId: string;
  peerSessionId: string;
  close(): Promise<void>;
};

async function seedSession(daemon: TestDaemon, fixture: string): Promise<string> {
  const { sessionId } = daemon.home.addTranscript({ fixture });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  return sessionId;
}

// A real HTTP server that answers every peer route wrongly: a body that is no contract type, and HTTP 500 without JSON.
export async function startBrokenPeer(): Promise<{ url: string; close(): Promise<void> }> {
  const port = await freePort();
  const server: Server = createServer((request, response) => {
    if (request.url === "/v1/sessions") {
      response.setHeader("content-type", "application/json").end('{"nope":1}');
      return;
    }
    response.statusCode = 500;
    response.end("not json");
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const close = async (): Promise<void> => new Promise<void>((resolve) => server.close(() => { resolve(); }));
  return { url: `http://127.0.0.1:${port}`, close };
}

// Calls one coordinator MCP tool by name and returns the text the model would read.
export async function runTool(backend: CoordinatorBackend, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const found = coordinatorTools(backend).find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  const result = await found.handler(args, undefined);
  const [first] = result.content;
  return { text: first?.type === "text" ? first.text : "", isError: result.isError === true };
}

export async function startLinkedPair(): Promise<LinkedPair> {
  const peer = await startTestDaemon({ name: PEER_NAME });
  const broken = await startBrokenPeer();
  const downPort = await freePort();
  const peers = [
    { name: PEER_NAME, url: peer.url },
    { name: UNLINKED_NAME, url: "http://127.0.0.1:9" },
    { name: DOWN_NAME, url: `http://127.0.0.1:${downPort}` },
    { name: BROKEN_NAME, url: broken.url },
  ];
  const peerTokens = { [PEER_NAME]: TEST_TOKEN, [DOWN_NAME]: TEST_TOKEN, [BROKEN_NAME]: TEST_TOKEN };
  const local = await startTestDaemon({ name: LOCAL_NAME, peers, coordinator: { enabled: true, mayApprove: true, peerTokens, model: null } });
  const peerSessionId = await seedSession(peer, "01-simple-session");
  const localSessionId = await seedSession(local, "05-edit-write-read-test-run");
  return {
    local,
    peer,
    localSessionId,
    peerSessionId,
    close: async (): Promise<void> => {
      await local.close();
      await peer.close();
      await broken.close();
    },
  };
}

export type PairSuite = { readonly pair: LinkedPair; readonly backend: CoordinatorBackend };

/** Starts a linked pair before the suite and closes it after; backend = the local daemon's coordinator backend. */
export function linkedPairSuite(): PairSuite {
  let started: { pair: LinkedPair; backend: CoordinatorBackend } | null = null;
  const get = (): { pair: LinkedPair; backend: CoordinatorBackend } => {
    if (started === null) throw new Error("the linked pair starts in beforeAll");
    return started;
  };
  beforeAll(async () => {
    const pair = await startLinkedPair();
    started = { pair, backend: createCoordinatorBackend(pair.local.config, pair.local.services, () => pair.localSessionId) };
  });
  afterAll(async () => {
    await get().pair.close();
  });
  return {
    get pair(): LinkedPair {
      return get().pair;
    },
    get backend(): CoordinatorBackend {
      return get().backend;
    },
  };
}
