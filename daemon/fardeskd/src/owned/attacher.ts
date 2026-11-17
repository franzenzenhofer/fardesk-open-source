import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { FardeskError } from "../core/errors.js";
import { resumeMode } from "./mode.js";
import { liveHolders } from "./lock.js";
import type { Opener } from "./opener.js";
import type { OwnedSet } from "./ownedSet.js";
import type { OwnedRunnerDeps } from "./runner.js";
import type { RunningSession } from "./session.js";
import type { OwnedEntry } from "./stateFile.js";

const TERMINAL_CONFLICT = "session is running in a terminal: take over instead";

export type Attacher = {
  /** Registers a freshly opened session under the id Claude Code reported. */
  track: (session: RunningSession, cwd: string, model: string | null) => Promise<string>;
  /** Resumes an existing session unless a live process holds it, in the last mode of `modeSource` (default: the session itself). */
  attach: (sessionId: string, cwd: string, model: string | null, modeSource?: string) => Promise<string>;
  /** Resumes one persisted entry or drops it with a warning. `transcriptIds`: the ids that have a transcript (read once per restore). */
  restoreEntry: (entry: OwnedEntry, transcriptIds: ReadonlySet<string>) => Promise<void>;
};

export function createAttacher(deps: OwnedRunnerDeps, owned: OwnedSet, open: Opener): Attacher {
  const track: Attacher["track"] = async (session, cwd, model) => {
    const id = await session.ready;
    owned.add(id, { session, cwd, model });
    return id;
  };
  const attach: Attacher["attach"] = async (sessionId, cwd, model, modeSource = sessionId) => {
    if (liveHolders(deps.claudeHome, sessionId).length > 0) throw new FardeskError("conflict", TERMINAL_CONFLICT);
    const extra: Options = { resume: sessionId };
    const permissionMode = resumeMode(deps, deps.findMode(modeSource));
    return track(open({ cwd, model, permissionMode, extra, knownId: sessionId }), cwd, model);
  };
  const restoreEntry: Attacher["restoreEntry"] = async (entry, transcriptIds) => {
    if (!transcriptIds.has(entry.sessionId)) {
      deps.log.warn("dropping owned session: transcript is gone", { sessionId: entry.sessionId });
      return;
    }
    await attach(entry.sessionId, entry.cwd, entry.model).catch((error: unknown) => {
      deps.log.warn("dropping owned session: cannot resume", { sessionId: entry.sessionId, reason: String(error) });
    });
  };
  return { track, attach, restoreEntry };
}
