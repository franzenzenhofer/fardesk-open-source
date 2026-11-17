import { FardeskError } from "../core/errors.js";
import { sleep } from "./sleep.js";

export type WaitForDeliveryOptions = {
  readLines: () => string[];
  text: string;
  timeoutMs: number;
  pollMs: number;
};

type Block = { type?: unknown; text?: unknown };

function contentContains(content: unknown, text: string): boolean {
  if (typeof content === "string") return content.includes(text);
  if (!Array.isArray(content)) return false;
  return (content as unknown[]).some((block) => {
    if (typeof block !== "object" || block === null) return false;
    const { text: blockText } = block as Block;
    return typeof blockText === "string" && blockText.includes(text);
  });
}

type Entry = {
  type?: unknown;
  message?: { content?: unknown };
  content?: unknown;
  operation?: unknown;
  attachment?: { type?: unknown; prompt?: unknown };
};

function parseEntry(line: string): Entry | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function isDeliveredEntry(entry: Entry, text: string): boolean {
  if (entry.type === "user") return contentContains(entry.message?.content, text);
  if (entry.type !== "attachment" || entry.attachment?.type !== "queued_command") return false;
  return contentContains(entry.attachment.prompt, text);
}

// A mid-turn message shows up as a queue-operation enqueue first: Claude Code has it, it has not read it yet.
function isQueuedEntry(entry: Entry, text: string): boolean {
  return entry.type === "queue-operation" && entry.operation === "enqueue" && contentContains(entry.content, text);
}

/** delivered = the transcript shows the message; queued = a busy session has not read it yet (Spike A). */
export type MessageOutcome = "delivered" | "queued";

function outcomeOf(lines: string[], text: string): MessageOutcome | null {
  const entries = lines.flatMap((line) => {
    const entry = parseEntry(line);
    return entry === null ? [] : [entry];
  });
  if (entries.some((entry) => isDeliveredEntry(entry, text))) return "delivered";
  return entries.some((entry) => isQueuedEntry(entry, text)) ? "queued" : null;
}

/** A busy session writes its queue-operation line at once or not before the turn ends: do not make the phone wait. */
export const BUSY_CONFIRM_MS = 600;

export type ConfirmOptions = WaitForDeliveryOptions & {
  /** The session was working when the message was sent: Claude Code queues it until the turn ends. */
  busy: boolean;
  sessionId: string;
};

// A busy session queues the message and the transcript shows it only after the turn, so a missing
// line is not a failure there. An idle session that does not take it is.
export async function confirmDelivery(options: ConfirmOptions): Promise<MessageOutcome> {
  const timeoutMs = options.busy ? Math.min(options.timeoutMs, BUSY_CONFIRM_MS) : options.timeoutMs;
  const outcome = await waitForOutcome({ ...options, timeoutMs });
  if (outcome !== null) return outcome;
  if (options.busy) return "queued";
  throw new FardeskError(
    "unsupported",
    `session ${options.sessionId} did not take the message within ${options.timeoutMs} ms; it may be holding it behind a dialog in the terminal`,
  );
}

export async function waitForOutcome(options: WaitForDeliveryOptions): Promise<MessageOutcome | null> {
  const deadline = Date.now() + options.timeoutMs;
  for (;;) {
    const outcome = outcomeOf(options.readLines(), options.text);
    if (outcome !== null) return outcome;
    if (Date.now() >= deadline) return null;
    await sleep(options.pollMs);
  }
}

export async function waitForDelivery(options: WaitForDeliveryOptions): Promise<boolean> {
  return (await waitForOutcome(options)) === "delivered";
}
