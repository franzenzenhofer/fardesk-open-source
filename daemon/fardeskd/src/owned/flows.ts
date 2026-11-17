import { forkSession, type Options } from "@anthropic-ai/claude-agent-sdk";
import type { NewSessionRequest } from "../contract/schema.js";
import { findTranscripts } from "../sessions/transcriptFiles.js";
import { createAttacher } from "./attacher.js";
import { startMode } from "./mode.js";
import { liveHolders, terminateHolders } from "./lock.js";
import type { Opener } from "./opener.js";
import type { OwnedSet } from "./ownedSet.js";
import type { OwnedRunnerDeps } from "./runner.js";
import type { OwnedRunner, SessionExtras } from "./types.js";

export type Flows = Pick<OwnedRunner, "start" | "resume" | "takeover" | "fork" | "restore">;

export function createFlows(deps: OwnedRunnerDeps, owned: OwnedSet, open: Opener): Flows {
  const { track, attach, restoreEntry } = createAttacher(deps, owned, open);
  const resume = async (sessionId: string): Promise<string> =>
    owned.has(sessionId) ? sessionId : attach(sessionId, deps.findCwd(sessionId), null);
  return {
    resume,
    async start(request: NewSessionRequest, extras: SessionExtras = {}): Promise<string> {
      const extra: Options = { ...(request.worktree ? { extraArgs: { worktree: null } } : {}), ...extras };
      const permissionMode = startMode(deps, request.permissionMode);
      const session = open({ cwd: request.cwd, model: request.model, permissionMode, extra, knownId: null });
      session.push(request.prompt);
      return track(session, request.cwd, request.model);
    },
    async takeover(sessionId): Promise<string> {
      if (owned.has(sessionId)) return sessionId;
      await terminateHolders(liveHolders(deps.claudeHome, sessionId), deps.kill);
      return resume(sessionId);
    },
    async fork(sessionId): Promise<string> {
      const cwd = deps.findCwd(sessionId);
      const copy = await forkSession(sessionId, { dir: cwd });
      return attach(copy.sessionId, cwd, null, sessionId);
    },
    async restore(): Promise<void> {
      const transcriptIds = new Set(findTranscripts(deps.claudeHome).map((ref) => ref.sessionId));
      await Promise.all(owned.persisted().map(async (entry) => restoreEntry(entry, transcriptIds)));
      owned.persist();
    },
  };
}
