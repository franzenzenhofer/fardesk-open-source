import { isDeepStrictEqual } from "node:util";
import type { Activity, PermissionDecision, PermissionState } from "../contract/schema.js";
import type { FinishedToolCall } from "../transcript/index.js";
import type { Bus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import { describeRequest } from "./describe.js";

export const HISTORY_LIMIT = 50;
const PENDING = "pending";

export type BrokerAnswer =
  | { state: "allowed"; always: boolean }
  | { state: "denied" }
  | { state: "answered"; option: string }
  | { state: "expired"; timedOut?: true };

export type AskInput = { sessionId: string; toolName: string; toolInput: unknown; cwd: string };
export type AskHandle = { requestId: string; kind: PendingKind; answer: Promise<BrokerAnswer> };
export type PendingKind = "permission" | "question";

export type BrokerOptions = {
  timeoutMs: number;
  bus: Bus;
  now: () => Date;
  newId: () => string;
};

export type Broker = {
  ask(input: AskInput): AskHandle;
  decide(sessionId: string, requestId: string, decision: PermissionDecision): void;
  answer(sessionId: string, requestId: string, option: string): void;
  cancelSession(sessionId: string): void;
  /** The request is moot (the hook connection closed because the dialog was answered in the terminal): no-op when already resolved. */
  cancelRequest(sessionId: string, requestId: string): void;
  /** The transcript holds this tool call's result: its pending permission request cannot be answered any more. */
  toolFinished(sessionId: string, call: FinishedToolCall): void;
  activities(sessionId: string): Activity[];
  pendingKind(sessionId: string): PendingKind | null;
  close(): void;
};

type BrokerActivity = Extract<Activity, { kind: PendingKind }>;

type Entry = {
  sessionId: string;
  requestId: string;
  activity: BrokerActivity;
  /** What the hook asked about: a finished tool call only ends the request for exactly this input. */
  toolInput: unknown;
  settle: (answer: BrokerAnswer) => void;
  timer: NodeJS.Timeout;
};

type Ledger = {
  entriesOf(sessionId: string): Entry[];
  add(entry: Entry): void;
  finish(entry: Entry, answer: BrokerAnswer): void;
  findPending(sessionId: string, requestId: string): Entry;
  expire(entries: Entry[]): void;
  all(): Entry[][];
};

const DECISION_ANSWERS: Record<PermissionDecision, BrokerAnswer> = {
  allow: { state: "allowed", always: false },
  allow_always: { state: "allowed", always: true },
  deny: { state: "denied" },
};

const EXPIRED: BrokerAnswer = { state: "expired" };
const TIMED_OUT: BrokerAnswer = { state: "expired", timedOut: true };

/** The transcript timestamp of a tool call is its tool_use line, written a moment before the hook fires. */
const TOOL_START_SLACK_MS = 5_000;

function permissionState(answer: BrokerAnswer): PermissionState {
  if (answer.state === "allowed") return "allowed";
  return answer.state === "denied" ? "denied" : "expired";
}

function resolvedActivity(activity: BrokerActivity, answer: BrokerAnswer): BrokerActivity {
  if (activity.kind === "permission") return { ...activity, state: permissionState(answer) };
  return { ...activity, state: answer.state === "answered" ? "answered" : "expired" };
}

/** Broker rows are told apart from transcript rows of the same tool call by this id prefix. */
export const BROKER_ID_PREFIX = "req-";

function buildActivity(input: AskInput, requestId: string, ts: string): BrokerActivity {
  const description = describeRequest(input.toolName, input.toolInput);
  const base = { id: `${BROKER_ID_PREFIX}${requestId}`, ts, requestId, state: PENDING } as const;
  if (description.kind === "question") {
    return { ...base, kind: "question", text: description.text, options: description.options };
  }
  const { title, summary, destructive } = description;
  return { ...base, kind: "permission", tool: input.toolName, title, summary, cwd: input.cwd, destructive };
}

const isPending = (entry: Entry): boolean => entry.activity.state === PENDING;

function findPendingEntry(entries: Entry[], sessionId: string, requestId: string): Entry {
  const entry = entries.find((e) => e.requestId === requestId && isPending(e));
  if (entry === undefined) throw new FardeskError("not_found", `no pending request ${requestId} in session ${sessionId}`);
  return entry;
}

function trimHistory(entries: Entry[]): void {
  while (entries.length > HISTORY_LIMIT) {
    const oldestResolved = entries.findIndex((entry) => !isPending(entry));
    if (oldestResolved === -1) return;
    entries.splice(oldestResolved, 1);
  }
}

function createLedger(bus: Bus): Ledger {
  const sessions = new Map<string, Entry[]>();
  const entriesOf = (sessionId: string): Entry[] => sessions.get(sessionId) ?? [];
  const publish = (entry: Entry): void => {
    bus.publish({ type: "activity", sessionId: entry.sessionId, activity: entry.activity });
  };
  const finish = (entry: Entry, answer: BrokerAnswer): void => {
    clearTimeout(entry.timer);
    entry.activity = resolvedActivity(entry.activity, answer);
    publish(entry);
    trimHistory(entriesOf(entry.sessionId));
    entry.settle(answer);
  };
  return {
    entriesOf,
    add(entry): void {
      sessions.set(entry.sessionId, [...entriesOf(entry.sessionId), entry]);
      publish(entry);
    },
    finish,
    findPending: (sessionId, requestId): Entry => findPendingEntry(entriesOf(sessionId), sessionId, requestId),
    expire(entries): void {
      for (const entry of entries.filter(isPending)) finish(entry, EXPIRED);
    },
    all: (): Entry[][] => [...sessions.values()],
  };
}

function requireKind<K extends PendingKind>(entry: Entry, kind: K): Extract<BrokerActivity, { kind: K }> {
  const { activity } = entry;
  if (activity.kind !== kind) {
    throw new FardeskError("invalid_request", `request ${entry.requestId} is a ${activity.kind}, not a ${kind}`);
  }
  return activity as Extract<BrokerActivity, { kind: K }>;
}

function checkOption(labels: string[], option: string): void {
  if (labels.length > 0 && !labels.includes(option)) {
    throw new FardeskError("invalid_request", `option "${option}" is not one of: ${labels.join(", ")}`);
  }
}

function startRequest(ledger: Ledger, options: BrokerOptions, input: AskInput): AskHandle {
  const requestId = options.newId();
  const activity = buildActivity(input, requestId, options.now().toISOString());
  let settle!: (answer: BrokerAnswer) => void;
  const answer = new Promise<BrokerAnswer>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => {
    ledger.finish(entry, TIMED_OUT);
  }, options.timeoutMs);
  timer.unref();
  const entry: Entry = { sessionId: input.sessionId, requestId, activity, toolInput: input.toolInput, settle, timer };
  ledger.add(entry);
  return { requestId, kind: activity.kind, answer };
}

function expireWhere(ledger: Ledger, sessionId: string, matches: (entry: Entry) => boolean): void {
  for (const entry of ledger.entriesOf(sessionId).filter((e) => isPending(e) && matches(e))) ledger.finish(entry, EXPIRED);
}

/** A permission request is for this tool call when it names the tool, carries the same input and was asked right then. */
function isCallOf(entry: Entry, call: FinishedToolCall): boolean {
  const { activity } = entry;
  if (activity.kind !== "permission" || activity.tool !== call.tool) return false;
  return Math.abs(Date.parse(activity.ts) - Date.parse(call.startedAt)) <= TOOL_START_SLACK_MS && isDeepStrictEqual(entry.toolInput, call.input);
}

export function createBroker(options: BrokerOptions): Broker {
  const ledger = createLedger(options.bus);
  return {
    ask: (input): AskHandle => startRequest(ledger, options, input),
    decide(sessionId, requestId, decision): void {
      const entry = ledger.findPending(sessionId, requestId);
      requireKind(entry, "permission");
      ledger.finish(entry, DECISION_ANSWERS[decision]);
    },
    answer(sessionId, requestId, option): void {
      const entry = ledger.findPending(sessionId, requestId);
      checkOption(requireKind(entry, "question").options, option);
      ledger.finish(entry, { state: "answered", option });
    },
    cancelSession: (sessionId): void => {
      ledger.expire(ledger.entriesOf(sessionId));
    },
    cancelRequest: (sessionId, requestId): void => {
      expireWhere(ledger, sessionId, (entry) => entry.requestId === requestId);
    },
    toolFinished: (sessionId, call): void => {
      expireWhere(ledger, sessionId, (entry) => isCallOf(entry, call));
    },
    activities: (sessionId): Activity[] => ledger.entriesOf(sessionId).map((entry) => entry.activity),
    pendingKind: (sessionId): PendingKind | null => ledger.entriesOf(sessionId).find(isPending)?.activity.kind ?? null,
    close(): void {
      for (const entries of ledger.all()) ledger.expire(entries);
    },
  };
}
