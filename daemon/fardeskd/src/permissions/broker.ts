import { isDeepStrictEqual } from "node:util";
import type { Activity, PermissionDecision, PermissionState } from "../contract/schema.js";
import type { FinishedToolCall } from "../transcript/index.js";
import type { Bus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import { describeRequest } from "./describe.js";
import { checkPlanDecision, isPlanChoice, planChoicesFor } from "./plan.js";
import type { PlanAnswer } from "./plan.js";
import { canType, terminalShapeOf } from "./terminalKeys.js";
import type { TerminalReach, TerminalShape } from "./terminalKeys.js";

export const HISTORY_LIMIT = 50;
const PENDING = "pending";
const TERMINAL = "terminal";

export type BrokerAnswer =
  | { state: "allowed"; always: boolean }
  | { state: "denied" }
  | ({ state: "planned" } & PlanAnswer)
  | { state: "answered"; option: string }
  | { state: "expired"; timedOut?: true };

export type AskInput = { sessionId: string; toolName: string; toolInput: unknown; cwd: string };
export type AskHandle = { requestId: string; kind: PendingKind; activity: BrokerActivity; answer: Promise<BrokerAnswer> };
export type PendingKind = "permission" | "question" | "dialog";
/** A Claude Code dialog (`request_user_dialog`): kind and payload as Claude Code sent them, `choices` the valid answers. */
export type DialogInput = { sessionId: string; dialogKind: string; payload: Record<string, unknown>; choices: string[] };

/** A request that timed out: its dialog now waits at the computer, and may still be answered by typing into it. */
export type HandedOff = { activity: BrokerActivity; shape: TerminalShape | null; typable: boolean };

export type BrokerOptions = {
  timeoutMs: number;
  bus: Bus;
  now: () => Date;
  newId: () => string;
  /** `owned.allowBypass`: a plan request offers "approve and switch to bypass permissions" only where this is on. */
  allowBypass: boolean;
};

export type Broker = {
  ask(input: AskInput): AskHandle;
  /** Holds a Claude Code dialog until the phone answers it or the session withdraws it. It never times out: Claude Code owns the deadline. */
  askDialog(input: DialogInput): AskHandle;
  answerDialog(sessionId: string, requestId: string, answer: string): void;
  /** `message` is what Claude should change in a plan: required for `revise`. The plan decisions only fit a plan request. */
  decide(sessionId: string, requestId: string, decision: PermissionDecision, message?: string): void;
  answer(sessionId: string, requestId: string, option: string): void;
  cancelSession(sessionId: string): void;
  /** The request is moot (the hook connection closed because the dialog was answered in the terminal): no-op when already resolved. */
  cancelRequest(sessionId: string, requestId: string): void;
  /** The transcript holds this tool call's result: its open permission or question request cannot be answered any more. */
  toolFinished(sessionId: string, call: FinishedToolCall): void;
  activities(sessionId: string): Activity[];
  pendingKind(sessionId: string): PendingKind | null;
  /** The request when it was handed off to the terminal and is still open there, else null. */
  handedOff(sessionId: string, requestId: string): HandedOff | null;
  /** Records whether the terminal of a handed-off request can be typed into (`typable` of its activity). */
  markReach(sessionId: string, requestId: string, reach: TerminalReach): void;
  close(): void;
};

export type BrokerActivity = Extract<Activity, { kind: PendingKind }>;

type Entry = {
  sessionId: string;
  requestId: string;
  activity: BrokerActivity;
  shape: TerminalShape | null;
  /** The tool the hook asked about (a question is the AskUserQuestion tool): a finished call of it ends the request. */
  toolName: string;
  /** What the hook asked about: a finished tool call only ends the request for exactly this input. */
  toolInput: unknown;
  settle: (answer: BrokerAnswer) => void;
  /** Null for a dialog: Claude Code decides how long it stays open. */
  timer: NodeJS.Timeout | null;
};

type Ledger = {
  entriesOf(sessionId: string): Entry[];
  add(entry: Entry): void;
  finish(entry: Entry, answer: BrokerAnswer): void;
  findPending(sessionId: string, requestId: string): Entry;
  expire(entries: Entry[]): void;
  /** Sends the entry's current activity to the clients again. */
  republish(entry: Entry): void;
  all(): Entry[][];
};

const DECISION_ANSWERS: Record<"allow" | "allow_always" | "deny", BrokerAnswer> = {
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
  if (answer.state === "planned") return answer.choice === "revise" ? "denied" : "allowed";
  return answer.state === "denied" ? "denied" : "expired";
}

function resolvedActivity(activity: BrokerActivity, answer: BrokerAnswer): BrokerActivity {
  // No answer in time: Claude Code shows its own dialog at the computer, so the request stays visible as "terminal".
  if (activity.kind !== "dialog" && answer.state === "expired" && answer.timedOut === true) return { ...activity, state: TERMINAL };
  if (activity.kind === "permission") return { ...activity, state: permissionState(answer) };
  return { ...activity, state: answer.state === "answered" ? "answered" : "expired" };
}

/** Broker rows are told apart from transcript rows of the same tool call by this id prefix. */
export const BROKER_ID_PREFIX = "req-";

function buildActivity(input: AskInput, requestId: string, ts: string, allowBypass: boolean): BrokerActivity {
  const description = describeRequest(input.toolName, input.toolInput);
  const base = { id: `${BROKER_ID_PREFIX}${requestId}`, ts, requestId, state: PENDING } as const;
  if (description.kind === "question") {
    return { ...base, kind: "question", text: description.text, options: description.options };
  }
  const { title, summary, destructive, plan } = description;
  const permission = { ...base, kind: "permission", tool: input.toolName, title, summary, cwd: input.cwd, destructive } as const;
  return plan === undefined ? permission : { ...permission, plan, planChoices: planChoicesFor(allowBypass) };
}

/** Turns a decision into the answer the waiting hook or session gets; a plan decision must fit the request. */
function answerFor(entry: Entry, decision: PermissionDecision, message: string | undefined): BrokerAnswer {
  if (!isPlanChoice(decision)) return DECISION_ANSWERS[decision];
  const { planChoices } = requireKind(entry, "permission");
  return { state: "planned", ...checkPlanDecision(planChoices, decision, message) };
}

const isPending = (entry: Entry): boolean => entry.activity.state === PENDING;
const isHandedOff = (entry: Entry): boolean => entry.activity.state === TERMINAL;
/** Still unresolved: waiting for the phone, or for the computer after the hand-off. */
const isOpen = (entry: Entry): boolean => isPending(entry) || isHandedOff(entry);

function findPendingEntry(entries: Entry[], sessionId: string, requestId: string): Entry {
  const entry = entries.find((e) => e.requestId === requestId && isPending(e));
  if (entry === undefined) throw new FardeskError("not_found", `no pending request ${requestId} in session ${sessionId}`);
  return entry;
}

function trimHistory(entries: Entry[]): void {
  while (entries.length > HISTORY_LIMIT) {
    const oldestResolved = entries.findIndex((entry) => !isOpen(entry));
    if (oldestResolved === -1) return;
    entries.splice(oldestResolved, 1);
  }
}

function createLedger(bus: Bus): Ledger {
  const sessions = new Map<string, Entry[]>();
  const entriesOf = (sessionId: string): Entry[] => sessions.get(sessionId) ?? [];
  const publish = (entry: Entry): void => {    bus.publish({ type: "activity", sessionId: entry.sessionId, activity: entry.activity });
  };
  const finish = (entry: Entry, answer: BrokerAnswer): void => {
    if (entry.timer !== null) clearTimeout(entry.timer);
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
      for (const entry of entries.filter(isOpen)) finish(entry, EXPIRED);
    },
    republish: publish,
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

function buildDialogActivity(input: DialogInput, requestId: string, ts: string): BrokerActivity {
  const { dialogKind, payload, choices } = input;
  return { id: `${BROKER_ID_PREFIX}${requestId}`, ts, requestId, state: PENDING, kind: "dialog", dialogKind, payload, choices };
}

type Opening = Pick<Entry, "sessionId" | "toolName" | "toolInput" | "shape"> & { build(requestId: string): BrokerActivity; timed: boolean };

function startRequest(ledger: Ledger, options: BrokerOptions, opening: Opening): AskHandle {
  const requestId = options.newId();
  const activity = opening.build(requestId);
  let settle!: (answer: BrokerAnswer) => void;
  const answer = new Promise<BrokerAnswer>((resolve) => {
    settle = resolve;
  });
  const { sessionId, toolName, toolInput, shape } = opening;
  const entry: Entry = { sessionId, requestId, activity, shape, toolName, toolInput, settle, timer: null };
  if (opening.timed) {
    entry.timer = setTimeout(() => {
      ledger.finish(entry, TIMED_OUT);
    }, options.timeoutMs);
    entry.timer.unref();
  }
  ledger.add(entry);
  return { requestId, kind: activity.kind, activity, answer };
}

function askOpening(options: BrokerOptions, input: AskInput): Opening {
  const { sessionId, toolName, toolInput } = input;
  const build = (requestId: string): BrokerActivity => buildActivity(input, requestId, options.now().toISOString(), options.allowBypass);
  return { sessionId, toolName, toolInput, shape: terminalShapeOf(toolName, toolInput), build, timed: true };
}

function dialogOpening(options: BrokerOptions, input: DialogInput): Opening {
  const build = (requestId: string): BrokerActivity => buildDialogActivity(input, requestId, options.now().toISOString());
  return { sessionId: input.sessionId, toolName: "", toolInput: null, shape: null, build, timed: false };
}

function expireWhere(ledger: Ledger, sessionId: string, matches: (entry: Entry) => boolean, open: (entry: Entry) => boolean): void {
  for (const entry of ledger.entriesOf(sessionId).filter((e) => open(e) && matches(e))) ledger.finish(entry, EXPIRED);
}

function handedOffEntry(ledger: Ledger, sessionId: string, requestId: string): Entry | null {
  return ledger.entriesOf(sessionId).find((entry) => entry.requestId === requestId && isHandedOff(entry)) ?? null;
}

function handedOffView(entry: Entry | null): HandedOff | null {
  return entry === null ? null : { activity: entry.activity, shape: entry.shape, typable: entry.activity.kind !== "dialog" && entry.activity.typable === true };
}

function markReach(ledger: Ledger, sessionId: string, requestId: string, reach: TerminalReach): void {
  const entry = handedOffEntry(ledger, sessionId, requestId);
  if (entry === null || entry.activity.kind === "dialog") return;
  const typable = canType(entry.shape, reach);
  if (entry.activity.typable === typable) return;
  entry.activity = { ...entry.activity, typable };
  ledger.republish(entry);
}

/** A request (permission or question) is for this tool call when it names the tool, carries the same input and was asked right then. */
function isCallOf(entry: Entry, call: FinishedToolCall): boolean {
  if (entry.toolName !== call.tool) return false;
  return Math.abs(Date.parse(entry.activity.ts) - Date.parse(call.startedAt)) <= TOOL_START_SLACK_MS && isDeepStrictEqual(entry.toolInput, call.input);
}

function dialogMethods(ledger: Ledger, options: BrokerOptions): Pick<Broker, "askDialog" | "answerDialog"> {
  return {
    askDialog: (input): AskHandle => startRequest(ledger, options, dialogOpening(options, input)),
    answerDialog: (sessionId, requestId, answer): void => {
      const entry = ledger.findPending(sessionId, requestId);
      checkOption(requireKind(entry, "dialog").choices, answer);
      ledger.finish(entry, { state: "answered", option: answer });
    },
  };
}

export function createBroker(options: BrokerOptions): Broker {
  const ledger = createLedger(options.bus);
  return {
    ask: (input): AskHandle => startRequest(ledger, options, askOpening(options, input)),
    ...dialogMethods(ledger, options),
    decide: (sessionId, requestId, decision, message): void => {
      const entry = ledger.findPending(sessionId, requestId);
      requireKind(entry, "permission");
      ledger.finish(entry, answerFor(entry, decision, message));
    },
    answer: (sessionId, requestId, option): void => {
      const entry = ledger.findPending(sessionId, requestId);
      checkOption(requireKind(entry, "question").options, option);
      ledger.finish(entry, { state: "answered", option });
    },
    cancelSession: (sessionId): void => { ledger.expire(ledger.entriesOf(sessionId)); },
    // The hook connection also closes after a time-out hand-off, so only a pending request is moot here.
    cancelRequest: (sessionId, requestId): void => { expireWhere(ledger, sessionId, (entry) => entry.requestId === requestId, isPending); },
    toolFinished: (sessionId, call): void => { expireWhere(ledger, sessionId, (entry) => isCallOf(entry, call), isOpen); },
    activities: (sessionId): Activity[] => ledger.entriesOf(sessionId).map((entry) => entry.activity),
    pendingKind: (sessionId): PendingKind | null => ledger.entriesOf(sessionId).find(isPending)?.activity.kind ?? null,
    handedOff: (sessionId, requestId): HandedOff | null => handedOffView(handedOffEntry(ledger, sessionId, requestId)),
    markReach: (sessionId, requestId, reach): void => {
      markReach(ledger, sessionId, requestId, reach);
    },
    close(): void {
      for (const entries of ledger.all()) ledger.expire(entries);
    },
  };
}
