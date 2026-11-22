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

/** An existing session to resume: its folder, model and the Claude home its transcript lives in. */
export type ResumeTarget = { sessionId: string; cwd: string; model: string | null; home: string };

export type Attacher = {
  /** Registers a freshly opened session under the id Claude Code reported. */
  track: (session: RunningSession, target: Omit<ResumeTarget, "sessionId">) => Promise<string>;
  /** Resumes an existing session unless a live process holds it, in the last mode of `modeSource` (default: the session itself). */
  attach: (target: ResumeTarget, modeSource?: string) => Promise<string>;
  /** Resumes one persisted entry or drops it with a warning. `homeOf`: session id to the configured home holding its transcript (read once per restore). */
  restoreEntry: (entry: OwnedEntry, homeOf: ReadonlyMap<string, string>) => Promise<void>;
};

export function createAttacher(deps: OwnedRunnerDeps, owned: OwnedSet, open: Opener): Attacher {
  const track: Attacher["track"] = async (session, { cwd, model, home }) => {
    const id = await session.ready;
    owned.add(id, { session, cwd, model, home });
    return id;
  };
  const attach: Attacher["attach"] = async (target, modeSource = target.sessionId) => {
    const { sessionId, cwd, model, home } = target;
    if (liveHolders(home, sessionId).length > 0) throw new FardeskError("conflict", TERMINAL_CONFLICT);
    const extra: Options = { resume: sessionId };
    const permissionMode = resumeMode(deps, deps.findMode(modeSource));
    return track(open({ cwd, home, model, permissionMode, extra, knownId: sessionId }), { cwd, model, home });
  };
  const restoreEntry: Attacher["restoreEntry"] = async (entry, homeOf) => {
    const home = homeOf.get(entry.sessionId);
    if (home === undefined) {
      deps.log.warn("dropping owned session: transcript is gone", { sessionId: entry.sessionId });
      return;
    }
    await attach({ ...entry, home }).catch((error: unknown) => {
      deps.log.warn("dropping owned session: cannot resume", { sessionId: entry.sessionId, reason: String(error) });
    });
  };
  return { track, attach, restoreEntry };
}
