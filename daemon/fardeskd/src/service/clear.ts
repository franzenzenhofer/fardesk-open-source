// /clear: owned sessions through the SDK, terminal sessions by typing it into their tmux pane or Ghostty terminal.
import { setTimeout as sleep } from "node:timers/promises";
import type { ClaudeHomeEntry } from "../config/claudeHomes.js";
import { FardeskError } from "../core/errors.js";
import { CLEAR_COMMAND, COMPACT_COMMAND } from "../owned/session.js";
import { readClaudeRegistry } from "../sessions/claudeRegistry.js";
import type { SessionRecord } from "../sessions/store.js";
import { COMPACT_SUBTYPE } from "../transcript/lineTypes.js";
import { locate, typeIntoPane } from "./terminal.js";
import type { Placement, TerminalDeps } from "./terminal.js";
import { readAppended, sizeOf } from "./transcriptTail.js";

export const CLEAR_WAIT_MS = 15_000;
/** A summary of a long session takes up to a few minutes; the hub waits 240 s for this route, the app longer. */
export const COMPACT_WAIT_MS = 180_000;
const REGISTRY_POLL_MS = 200;

export type ClearTerminal = {
  terminal: TerminalDeps;
  claudeHomes: ClaudeHomeEntry[];
  machineName: string;
  requireNotWaiting(record: SessionRecord): void;
  /** Overrides CLEAR_WAIT_MS (tests). */
  waitMs?: number;
  /** Overrides COMPACT_WAIT_MS (tests). */
  compactWaitMs?: number;
};

export const isClearCommand = (text: string): boolean => text.trim() === CLEAR_COMMAND;

/** Messages cannot carry /clear: the clear route re-keys the session, a message answer has no place for the new id. */
export function rejectClearMessage(text: string): void {
  if (isClearCommand(text)) throw new FardeskError("invalid_request", "use POST /v1/sessions/:id/clear to clear a session");
}

function registeredSessionId(homes: ClaudeHomeEntry[], pid: number): string | null {
  for (const { path: home } of homes) {
    const found = readClaudeRegistry(home).processes.find((process) => process.pid === pid);
    if (found !== undefined) return found.sessionId;
  }
  return null;
}

async function waitForNewSession(deps: ClearTerminal, pid: number, previousId: string): Promise<string> {
  const waitMs = deps.waitMs ?? CLEAR_WAIT_MS;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const current = registeredSessionId(deps.claudeHomes, pid);
    if (current !== null && current !== previousId) return current;
    await sleep(REGISTRY_POLL_MS);
  }
  throw new FardeskError("internal", `/clear was typed into ${previousId} but Claude Code did not start a new session within ${waitMs / 1000} s`);
}

async function type(deps: ClearTerminal, placement: Placement, record: SessionRecord, command: string): Promise<boolean> {
  if (placement.kind === "pane") {
    deps.requireNotWaiting(record);
    await typeIntoPane(deps.terminal, placement, command);
    return true;
  }
  if (placement.kind === "ghostty") {
    deps.requireNotWaiting(record);
    await deps.terminal.ghostty.type(placement.terminalId, command);
    return true;
  }
  return false;
}

type TypedCommand = { command: string; ended: string; unsupportedHint: string };

/** Types a slash command into the session's terminal and answers the pid of the process it went to. */
async function typeCommand(deps: ClearTerminal, record: SessionRecord, typed: TypedCommand): Promise<number> {
  const { id, title } = record.summary;
  const pid = record.process?.pid ?? null;
  if (pid === null) throw new FardeskError("conflict", `session ${id} has ended: ${typed.ended}`);
  const placement = await locate(deps.terminal, pid);
  if (!(await type(deps, placement, record, typed.command))) {
    throw new FardeskError(
      "unsupported",
      `${title} on ${deps.machineName} runs outside tmux and Ghostty: ${typed.command} can only be typed there. ${typed.unsupportedHint}`,
    );
  }
  return pid;
}

/** Types /clear into the session's terminal and resolves with the id of the session Claude Code starts in its place. */
export async function clearTerminalSession(deps: ClearTerminal, record: SessionRecord): Promise<string> {
  const pid = await typeCommand(deps, record, {
    command: CLEAR_COMMAND,
    ended: "resume it first, then clear it",
    unsupportedHint: "Use Take Over, then Clear.",
  });
  return waitForNewSession(deps, pid, record.summary.id);
}

function isCompactBoundary(line: string): boolean {
  try {
    const entry: unknown = JSON.parse(line);
    if (typeof entry !== "object" || entry === null) return false;
    const { type, subtype } = entry as { type?: unknown; subtype?: unknown };
    return type === "system" && subtype === COMPACT_SUBTYPE;
  } catch {
    return false;
  }
}

async function waitForCompactBoundary(path: string, offset: number, waitMs: number, sessionId: string): Promise<void> {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if (readAppended(path, offset).some(isCompactBoundary)) return;
    await sleep(REGISTRY_POLL_MS);
  }
  throw new FardeskError("internal", `/compact was typed into ${sessionId} but Claude Code did not finish the summary within ${waitMs / 1000} s`);
}

/**
 * Types /compact into the session's terminal and resolves once Claude Code wrote the summary (its compact
 * boundary in the transcript). The session keeps its id. Answering earlier let a message sent right after
 * reach Claude Code during the summary, and the session still looked cold, so the phone asked again.
 */
export async function compactTerminalSession(deps: ClearTerminal, record: SessionRecord): Promise<void> {
  const path = record.transcriptPath;
  if (path === null) throw new FardeskError("conflict", `session ${record.summary.id} has no transcript yet: send it a message first`);
  const offset = sizeOf(path);
  await typeCommand(deps, record, {
    command: COMPACT_COMMAND,
    ended: "resume it first, then compact it",
    unsupportedHint: "Use Take Over first.",
  });
  await waitForCompactBoundary(path, offset, deps.compactWaitMs ?? COMPACT_WAIT_MS, record.summary.id);
}

export const isCompactCommand = (text: string): boolean => text.trim() === COMPACT_COMMAND;

/** Same as /clear: the compact route is the one place that waits for the result. */
export function rejectCompactMessage(text: string): void {
  if (isCompactCommand(text)) throw new FardeskError("invalid_request", "use POST /v1/sessions/:id/compact");
}
