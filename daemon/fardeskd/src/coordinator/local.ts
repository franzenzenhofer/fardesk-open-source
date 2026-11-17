// This machine as a coordinator endpoint (Services), and the table of all machines (this one plus the peers).
import type { Config } from "../config/config.js";
import { FardeskError } from "../core/errors.js";
import type { Services } from "../service/types.js";
import { createRemoteEndpoint } from "./remote.js";
import type { MachineEndpoint } from "./types.js";

export type LocalServices = Pick<
  Services,
  | "sessions"
  | "allSessions"
  | "activity"
  | "message"
  | "newSession"
  | "stop"
  | "searchFolders"
  | "notifyPhone"
  | "decide"
  | "answer"
  | "resume"
  | "clear"
  | "compact"
  | "kill"
>;
export type BackendConfig = Pick<Config, "name" | "peers" | "coordinator">;
export type Machine = { name: string; endpoint: MachineEndpoint | null };

export function createLocalEndpoint(services: LocalServices): MachineEndpoint {
  return {
    sessions: () => Promise.resolve(services.sessions()),
    allSessions: () => Promise.resolve(services.allSessions()),
    activity: (sessionId, limit) => Promise.resolve(services.activity(sessionId, { limit })),
    message: async (sessionId, text): Promise<void> => {
      await services.message(sessionId, text);
    },
    spawn: async (request) => (await services.newSession(request)).sessionId,
    stop: async (sessionId) => services.stop(sessionId),
    folders: (query, limit) => Promise.resolve(services.searchFolders(query, limit)),
    async decide(sessionId, requestId, decision): Promise<void> {
      services.decide(sessionId, requestId, decision);
      return Promise.resolve();
    },
    async answer(sessionId, requestId, option): Promise<void> {
      services.answer(sessionId, requestId, option);
      return Promise.resolve();
    },
    resume: async (sessionId) => (await services.resume(sessionId)).sessionId,
    clear: async (sessionId) => (await services.clear(sessionId)).sessionId,
    compact: async (sessionId) => (await services.compact(sessionId)).sessionId,
    kill: async (sessionId) => services.kill(sessionId, false),
  };
}

export function machinesOf(config: BackendConfig, services: LocalServices): Machine[] {
  const local: Machine = { name: config.name, endpoint: createLocalEndpoint(services) };
  const peers = config.peers.map((peer): Machine => {
    const token = config.coordinator.peerTokens[peer.name];
    return { name: peer.name, endpoint: token === undefined ? null : createRemoteEndpoint(peer, token) };
  });
  return [local, ...peers];
}

export function requireEndpoint(machines: Machine[], name: string): MachineEndpoint {
  const machine = machines.find((candidate) => candidate.name === name);
  if (machine === undefined) {
    throw new FardeskError("not_found", `unknown machine ${name}; known machines: ${machines.map((candidate) => candidate.name).join(", ")}`);
  }
  if (machine.endpoint === null) {
    throw new FardeskError("unsupported", `machine ${name} is not linked: add a token for it to coordinator.peerTokens in the config`);
  }
  return machine.endpoint;
}
