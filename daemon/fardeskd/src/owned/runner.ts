import type { PermissionMode } from "../contract/schema.js";
import type { Logger } from "../core/log.js";
import type { Broker } from "../permissions/broker.js";
import { createFlows } from "./flows.js";
import { waitForRelease, type KillTiming } from "./lock.js";
import { createOpener } from "./opener.js";
import { createOwnedSet } from "./ownedSet.js";
import { createStateFile } from "./stateFile.js";
import type { OwnedRunner } from "./types.js";

export type OwnedRunnerDeps = {
  claudeBinary: string;
  claudeHome: string;
  statePath: string;
  /** The mode of sessions that have no mode of their own (new sessions without a request mode, resumes without a transcript mode). */
  permissionMode: PermissionMode;
  /** False refuses bypassPermissions for new sessions and downgrades resumed ones (config owned.allowBypass). */
  allowBypass: boolean;
  interruptTimeoutMs: number;
  /** How long /clear may take until Claude Code reports the new conversation. */
  clearTimeoutMs: number;
  /** How long /compact may take until the transcript shows the compact boundary. */
  compactTimeoutMs: number;
  kill: KillTiming;
  broker: Broker;
  log: Logger;
  findCwd(sessionId: string): string;
  /** The mode the session's last turn ran in, from its transcript; null when unknown. */
  findMode(sessionId: string): PermissionMode | null;
};

export function createOwnedRunner(deps: OwnedRunnerDeps): OwnedRunner {
  const owned = createOwnedSet(createStateFile(deps.statePath));
  const flows = createFlows(deps, owned, createOpener(deps, owned));
  return {
    ...flows,
    send(sessionId, text, images): void {
      owned.require(sessionId).session.push(text, images);
    },
    interrupt: async (sessionId): Promise<void> => {
      await owned.require(sessionId).session.interrupt(deps.interruptTimeoutMs);
    },
    async stop(sessionId): Promise<void> {
      await owned.require(sessionId).session.close();
      await waitForRelease(deps.claudeHome, sessionId, deps.kill);
    },
    clear: async (sessionId): Promise<string> => owned.require(sessionId).session.clear(deps.clearTimeoutMs),
    compact: async (sessionId): Promise<void> => owned.require(sessionId).session.compact(deps.compactTimeoutMs),
    isOwned: (sessionId): boolean => owned.has(sessionId),
    isBusy: (sessionId): boolean => owned.has(sessionId) && owned.require(sessionId).session.busy(),
    async close(): Promise<void> {
      owned.freeze();
      const entries = owned.entries();
      await Promise.all(entries.map(async ([, entry]) => entry.session.close()));
      await Promise.all(entries.map(async ([id]) => waitForRelease(deps.claudeHome, id, deps.kill)));
    },
  };
}
