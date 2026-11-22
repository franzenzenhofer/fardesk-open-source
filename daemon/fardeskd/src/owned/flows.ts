import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { homePaths, type ClaudeHomeEntry } from "../config/claudeHomes.js";
import type { NewSessionRequest } from "../contract/schema.js";
import { findTranscripts } from "../sessions/transcriptFiles.js";
import { createAttacher } from "./attacher.js";
import { forkInHome } from "./forkInHome.js";
import type { ResumeTarget } from "./attacher.js";
import { startHome } from "./homes.js";
import { startMode } from "./mode.js";
import { liveHolders, terminateHolders } from "./lock.js";
import type { Opener } from "./opener.js";
import type { OwnedSet } from "./ownedSet.js";
import type { OwnedRunnerDeps } from "./runner.js";
import type { OwnedRunner, SessionExtras } from "./types.js";

export type Flows = Pick<OwnedRunner, "start" | "resume" | "takeover" | "fork" | "restore">;

/** Session id to the configured home its transcript lives in: a stored path is never trusted. */
const configuredHomeOf = (homes: readonly ClaudeHomeEntry[]): Map<string, string> =>
  new Map(homePaths(homes).flatMap((home) => findTranscripts(home).map((ref): [string, string] => [ref.sessionId, home])));

const newSessionExtra = (request: NewSessionRequest, extras: SessionExtras): Options => ({
  ...(request.worktree ? { extraArgs: { worktree: null } } : {}),
  ...extras,
});

/** Where to resume `sessionId`: the Claude home the store sees it in. */
const resumeTarget = (deps: OwnedRunnerDeps, sessionId: string, cwd: string): ResumeTarget => ({
  sessionId,
  cwd,
  model: null,
  home: deps.findHome(sessionId),
});

export function createFlows(deps: OwnedRunnerDeps, owned: OwnedSet, open: Opener): Flows {
  const { track, attach, restoreEntry } = createAttacher(deps, owned, open);
  const resume = async (sessionId: string): Promise<string> =>
    owned.has(sessionId) ? sessionId : attach(resumeTarget(deps, sessionId, deps.findCwd(sessionId)));
  return {
    resume,
    async start(request: NewSessionRequest, extras: SessionExtras = {}): Promise<string> {
      const home = startHome(deps.claudeHomes, request.home).path;
      const session = open({ cwd: request.cwd, home, model: request.model, permissionMode: startMode(deps, request.permissionMode), extra: newSessionExtra(request, extras), knownId: null });
      session.push(request.prompt);
      return track(session, { cwd: request.cwd, model: request.model, home });
    },
    async takeover(sessionId): Promise<string> {
      if (owned.has(sessionId)) return sessionId;
      await terminateHolders(liveHolders(deps.findHome(sessionId), sessionId), deps.kill);
      return resume(sessionId);
    },
    async fork(sessionId): Promise<string> {
      const source = resumeTarget(deps, sessionId, deps.findCwd(sessionId));
      const copy = await forkInHome(sessionId, source.cwd, source.home);
      return attach({ ...source, sessionId: copy }, sessionId);
    },
    async restore(): Promise<void> {
      const entries = owned.persisted();
      const homeOf = configuredHomeOf(deps.claudeHomes);
      await Promise.all(entries.map(async (entry) => restoreEntry(entry, homeOf)));
      owned.persist();
    },
  };
}
