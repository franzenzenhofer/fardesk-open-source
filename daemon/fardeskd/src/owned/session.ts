import { query, type Options, type PermissionResult, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { createDeferred, type Deferred } from "./deferred.js";
import { createInputQueue, userMessage, type InputQueue } from "./inputQueue.js";
import type { OwnedImage } from "./types.js";

export type PermissionAsk = (
  sessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  suggestions: unknown,
) => Promise<PermissionResult>;

export type SessionDeps = {
  /** Known for resumed sessions, null for new ones (learned from system/init). */
  sessionId: string | null;
  options: Omit<Options, "canUseTool">;
  askPermission: PermissionAsk;
  log: Logger;
  onEnd(): void;
  /** The conversation was replaced (/clear): the session continues under a new id. */
  onReset(previousId: string, newId: string): void;
};

export type RunningSession = {
  ready: Promise<string>;
  id(): string | null;
  busy(): boolean;
  push(text: string, images?: OwnedImage[]): void;
  interrupt(timeoutMs: number): Promise<void>;
  /** Types /clear into the running session; resolves with the new session id once Claude Code reports the reset. */
  clear(timeoutMs: number): Promise<string>;
  /** Types /compact into the running session; resolves once Claude Code reports the compact boundary. */
  compact(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
};

export const CLEAR_COMMAND = "/clear";
export const COMPACT_COMMAND = "/compact";

type Tracker = { id: string | null; pendingTurns: number; closing: boolean; reset: Deferred<string> | null; compacted: Deferred<null> | null };

// /clear: Claude Code sends a conversation_reset frame, but its `new_conversation_id` is NOT the id the new
// transcript is written under (observed 2026-11-16, claude 2.x): the id is the `session_id` of the system/init
// frame that follows. So an init frame with a different id than the one we track is the re-key signal.
function noteInit(sessionId: string, tracker: Tracker, ready: Deferred<string>, deps: SessionDeps): void {
  const previous = tracker.id;
  tracker.id = sessionId;
  ready.resolve(sessionId);
  if (previous === null || previous === sessionId) return;
  deps.onReset(previous, sessionId);
  tracker.reset?.resolve(sessionId);
  tracker.reset = null;
}

function noteMessage(message: SDKMessage, tracker: Tracker, ready: Deferred<string>, deps: SessionDeps): void {
  if (message.type === "system" && message.subtype === "init") {
    noteInit(message.session_id, tracker, ready, deps);
  } else if (message.type === "system" && message.subtype === "compact_boundary") {
    tracker.compacted?.resolve(null);
    tracker.compacted = null;
  } else if (message.type === "result") {
    tracker.pendingTurns = Math.max(0, tracker.pendingTurns - 1);
  } else if (message.type === "system" && message.subtype === "session_state_changed" && message.state === "idle") {
    // Claude Code folds a message sent mid-turn into the running turn: two pushes, one result. Only idle says the turn is over.
    tracker.pendingTurns = 0;
  }
}

async function drain(stream: Query, tracker: Tracker, ready: Deferred<string>, deps: SessionDeps): Promise<unknown> {
  try {
    for await (const message of stream) noteMessage(message, tracker, ready, deps);
    return null;
  } catch (error) {
    return error;
  }
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : "stream ended";
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new FardeskError("conflict", `${what} did not finish within ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function openStream(deps: SessionDeps, input: InputQueue, tracker: Tracker, ready: Deferred<string>): Query {
  return query({
    prompt: input.messages,
    options: {
      ...deps.options,
      canUseTool: async (toolName, toolInput, options) =>
        deps.askPermission(tracker.id ?? (await ready.promise), toolName, toolInput, options.suggestions),
    },
  });
}

async function requestClear(input: InputQueue, tracker: Tracker, timeoutMs: number): Promise<string> {
  const reset = createDeferred<string>();
  tracker.reset = reset;
  input.push(userMessage(CLEAR_COMMAND));
  return withTimeout(reset.promise, timeoutMs, CLEAR_COMMAND);
}

async function requestCompact(input: InputQueue, tracker: Tracker, timeoutMs: number): Promise<void> {
  const compacted = createDeferred<null>();
  tracker.compacted = compacted;
  tracker.pendingTurns += 1;
  input.push(userMessage(COMPACT_COMMAND));
  await withTimeout(compacted.promise, timeoutMs, COMPACT_COMMAND);
}

async function drainUntilEnd(stream: Query, tracker: Tracker, ready: Deferred<string>, deps: SessionDeps): Promise<void> {
  const error = await drain(stream, tracker, ready, deps);
  if (error !== null && !tracker.closing) deps.log.error("owned session stream failed", { reason: failure(error) });
  ready.reject(new FardeskError("internal", `claude ended before reporting a session id: ${failure(error)}`));
  deps.onEnd();
}

export function createSession(deps: SessionDeps): RunningSession {
  const input = createInputQueue();
  const ready = createDeferred<string>();
  const tracker: Tracker = { id: deps.sessionId, pendingTurns: 0, closing: false, reset: null, compacted: null };
  if (deps.sessionId !== null) ready.resolve(deps.sessionId);
  const stream = openStream(deps, input, tracker, ready);
  const finished = drainUntilEnd(stream, tracker, ready, deps);
  return {
    ready: ready.promise,
    id: (): string | null => tracker.id,
    busy: (): boolean => tracker.pendingTurns > 0,
    push(text, images): void {
      tracker.pendingTurns += 1;
      input.push(userMessage(text, images));
    },
    interrupt: async (timeoutMs): Promise<void> => {
      if (tracker.pendingTurns > 0) await withTimeout(stream.interrupt(), timeoutMs, "interrupt");
    },
    clear: async (timeoutMs): Promise<string> => requestClear(input, tracker, timeoutMs),
    compact: async (timeoutMs): Promise<void> => requestCompact(input, tracker, timeoutMs),
    close: async (): Promise<void> => {
      tracker.closing = true;
      input.close();
      stream.close();
      await finished;
    },
  };
}
