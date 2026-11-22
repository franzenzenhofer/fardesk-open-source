// Decides what to push: pending permission/question requests, finished turns (Stop hook), ended sessions.
import type { Activity, NotificationType, SessionStatus, SessionSummary } from "../contract/schema.js";
import type { PushContent } from "../config/config.js";
import type { Bus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import { truncate } from "../transcript/text.js";
import { isDeadTokenError } from "./apns.js";
import type { ApnsCategory, ApnsClient, ApnsNotification } from "./apns.js";
import type { Device, DeviceStore } from "./deviceStore.js";

export const DONE_BODY_MAX_CHARS = 160;
const ENDED_STATUS: SessionStatus = "ended";
const ENDED_FALLBACK_BODY = "Session ended";
const DONE_FALLBACK_BODY = "Finished";

export type SessionLabel = { title: string; summary: string };
export type StopReport = { sessionId: string; lastAssistantMessage: string | null };

export type NotifierDeps = {
  bus: Bus;
  apns: Pick<ApnsClient, "send"> | null;
  devices: DeviceStore;
  describe(sessionId: string): SessionLabel;
  isMuted(sessionId: string): boolean;
  notificationsEnabled: readonly NotificationType[];
  machineName: string;
  /** "generic": the push says only that a session on this machine needs you or is done; "full" adds titles, summaries and assistant text. */
  content: PushContent;
  log: Logger;
  /** True while the user paused notifications; nothing is pushed then. */
  isPaused?: () => boolean;
  /**
   * True when this daemon knows the session (its transcript is in a watched Claude home). Hooks also
   * fire for Claude processes that are not this machine's sessions, e.g. test runs with their own
   * Claude home: on 2026-11-16 that was nearly all of 282 push attempts in an hour on one Mac.
   */
  isKnown?: (sessionId: string) => boolean;
  /** True when the session is working again, so a pending "done" push is stale. */
  isWorking?: (sessionId: string) => boolean;
  /** Quiet period after a Stop before "done" is pushed; a newer Stop restarts it. */
  doneDelayMs?: number;
  /** True while the request still waits at the computer: the hand-off push is only for a dialog that really is open. */
  stillWaiting?: (sessionId: string, requestId: string) => boolean;
};

export const DEFAULT_DONE_DELAY_MS = 20_000;

export const HAND_OFF_LEAD = "Still waiting at the computer";
export const REQUEST_BODY_MAX_CHARS = 160;

export type Notifier = {
  done(report: StopReport): void;
  /** One more push, of the kind of the request that timed out (so a device that enabled only that kind gets it), and Claude Code fell back to its dialog at the computer. It names what the dialog asks. */
  handOff(sessionId: string, request: PendingRequest): void;
  ping(sessionId: string, title: string, body: string): Promise<number>;
  close(): void;
};

type Pending = Extract<Activity, { kind: "permission" | "question" | "dialog" }>;
export type PendingRequest = Pending;
type Outgoing = {
  type: NotificationType;
  category: ApnsCategory;
  sessionId: string;
  body: string;
  requestId: string | null;
  /** The category whose delivered notification this push replaces (same collapse id), when it is not its own. */
  replaces?: ApnsCategory;
  /** The quiet "handled" notice that withdraws an earlier request push (passive, same collapse id, `kind: "resolved"`). */
  resolved?: true;
};

const isPendingRequest = (activity: Activity): activity is Pending =>
  (activity.kind === "permission" || activity.kind === "question" || activity.kind === "dialog") && activity.state === "pending";

/** A request that no longer waits anywhere: answered, denied, or expired (a hand-off to the terminal, state "terminal", still waits). */
const isSettledRequest = (activity: Activity): activity is Pending =>
  (activity.kind === "permission" || activity.kind === "question" || activity.kind === "dialog") && activity.state !== "pending" && activity.state !== "terminal";

type SentRequests = Map<string, ApnsCategory>;

export const RESOLVED_TITLE = "Answered";
export const RESOLVED_GENERIC_BODY = "A request was handled";
const DIALOG_BODY = "Claude Code asks for your decision";

/** A dialog is pushed as a question: the same notification category and type setting. */
const requestType = (kind: Pending["kind"]): NotificationType => (kind === "permission" ? "permission" : "question");
const requestCategory = (kind: Pending["kind"]): ApnsCategory => (kind === "permission" ? "PERMISSION" : "QUESTION");

/** What the request is about: the (first) question, or the tool with a short summary of its input. */
function requestBody(activity: Pending): string {
  if (activity.kind === "question") return truncate(activity.text, REQUEST_BODY_MAX_CHARS);
  if (activity.kind === "dialog") return DIALOG_BODY;
  return activity.summary === "" ? activity.title : truncate(`${activity.tool}: ${activity.summary}`, REQUEST_BODY_MAX_CHARS);
}

/** True when APNs accepted the push; a dead token also removes the device. */
async function deliver(deps: NotifierDeps, apns: Pick<ApnsClient, "send">, device: Device, notification: ApnsNotification): Promise<boolean> {
  const { apnsToken: token, environment } = device;
  try {
    await apns.send(token, environment, notification);
    return true;
  } catch (error) {
    if (!isDeadTokenError(error)) {
      deps.log.warn("push_failed", { error: String(error) });
      return false;
    }
    deps.devices.remove(token);
    deps.log.info("push_device_removed", { reason: String(error) });
    return false;
  }
}

const GENERIC_TITLE = "Fardesk";
const GENERIC_WORDING: Record<NotificationType, string> = { permission: "needs you", question: "needs you", done: "is done", ended: "has ended" };

/** What the push shows: the real texts with `full`, else only the machine name and the kind of event. */
function visibleText(deps: NotifierDeps, outgoing: Outgoing, title: string): { title: string; body: string } {
  if (outgoing.resolved === true) {
    return deps.content === "full" ? { title: RESOLVED_TITLE, body: title } : { title: GENERIC_TITLE, body: RESOLVED_GENERIC_BODY };
  }
  if (deps.content === "full") return { title, body: outgoing.body };
  return { title: GENERIC_TITLE, body: `A session on ${deps.machineName} ${GENERIC_WORDING[outgoing.type]}` };
}

function buildNotification(deps: NotifierDeps, outgoing: Outgoing, title: string): ApnsNotification {
  const data: Record<string, string> = { sessionId: outgoing.sessionId, machine: deps.machineName };
  if (outgoing.requestId !== null) data["requestId"] = outgoing.requestId;
  if (outgoing.resolved === true) data["kind"] = "resolved";
  return { ...visibleText(deps, outgoing, title), category: outgoing.category, threadId: outgoing.sessionId, data };
}

/** Why this push must not go out (logged), or null to send it. A withdrawal always goes out: the stale request must not stay. */
function skipReason(deps: NotifierDeps, outgoing: Outgoing): string | null {
  if (outgoing.resolved === true) return null;
  if (deps.isPaused?.() === true) return "paused";
  if (deps.isKnown !== undefined && !deps.isKnown(outgoing.sessionId)) return "unknown session";
  return null;
}

/** True when the push was handed to APNs for the registered devices (not skipped, not switched off). */
function push(deps: NotifierDeps, outgoing: Outgoing): boolean {
  const { apns } = deps;
  const withdrawal = outgoing.resolved === true;
  if (apns === null || !deps.notificationsEnabled.includes(outgoing.type) || (!withdrawal && deps.isMuted(outgoing.sessionId))) return false;
  const reason = skipReason(deps, outgoing);
  if (reason !== null) {
    deps.log.info("push_skipped", { reason, type: outgoing.type, sessionId: outgoing.sessionId });
    return false;
  }
  // One notification per session and kind: a newer one replaces the older one on the device.
  const notification: ApnsNotification = {
    ...buildNotification(deps, outgoing, deps.describe(outgoing.sessionId).title),
    collapseId: `${outgoing.sessionId}:${outgoing.replaces ?? outgoing.category}`,
  };
  const targets = deps.devices.list().filter((entry) => entry.notifications.includes(outgoing.type));
  void Promise.all(targets.map(async (device) => deliver(deps, apns, device, notification))).then((results) => {
    deps.log.info("push_sent", { type: outgoing.type, sessionId: outgoing.sessionId, devices: results.filter(Boolean).length });
  });
  return true;
}

/** Pushes a "done" notification with a chosen title to every registered device and counts the ones APNs accepted. */
async function ping(deps: NotifierDeps, sessionId: string, title: string, body: string): Promise<number> {
  const { apns } = deps;
  if (apns === null) throw new FardeskError("unsupported", "push is not configured on this machine (config.apns is null)");
  const devices = deps.devices.list();
  if (devices.length === 0) throw new FardeskError("conflict", "no device is registered on this machine for push");
  const notification = buildNotification(deps, { type: "done", category: "DONE", sessionId, body, requestId: null }, title);
  const results = await Promise.all(devices.map(async (device) => deliver(deps, apns, device, notification)));
  return results.filter(Boolean).length;
}

function onSession(deps: NotifierDeps, lastStatus: Map<string, SessionStatus>, session: SessionSummary): void {
  const previous = lastStatus.get(session.id);
  lastStatus.set(session.id, session.status);
  if (session.status !== ENDED_STATUS || previous === undefined || previous === ENDED_STATUS) return;
  const body = session.summary === "" ? ENDED_FALLBACK_BODY : session.summary;
  push(deps, { type: "ended", category: "ENDED", sessionId: session.id, body, requestId: null });
}

function onRequest(deps: NotifierDeps, sent: SentRequests, sessionId: string, activity: Pending): void {
  const category = requestCategory(activity.kind);
  if (push(deps, { type: requestType(activity.kind), category, sessionId, body: requestBody(activity), requestId: activity.requestId })) {
    sent.set(activity.requestId, category);
  }
}

/** The request is answered, denied or expired: a quiet notice with the request's collapse id replaces its pushes on the devices. */
function onSettled(deps: NotifierDeps, sent: SentRequests, sessionId: string, activity: Pending): void {
  const category = sent.get(activity.requestId);
  if (category === undefined) return;
  sent.delete(activity.requestId);
  push(deps, { type: requestType(activity.kind), category: "RESOLVED", sessionId, body: "", requestId: activity.requestId, replaces: category, resolved: true });
}

function onDone(deps: NotifierDeps, { sessionId, lastAssistantMessage }: StopReport): void {
  const text = (lastAssistantMessage ?? "").trim();
  const summary = deps.describe(sessionId).summary;
  const body = text === "" ? summary || DONE_FALLBACK_BODY : truncate(text, DONE_BODY_MAX_CHARS);
  push(deps, { type: "done", category: "DONE", sessionId, body, requestId: null });
}

/** Delays "done" per session: a newer Stop restarts the wait, and a session working again drops it. */
function createDoneQuiet(deps: NotifierDeps): { schedule(report: StopReport): void; close(): void } {
  const delay = deps.doneDelayMs ?? DEFAULT_DONE_DELAY_MS;
  const timers = new Map<string, NodeJS.Timeout>();
  return {
    schedule(report): void {
      clearTimeout(timers.get(report.sessionId));
      timers.set(report.sessionId, setTimeout(() => {
        timers.delete(report.sessionId);
        if (deps.isWorking?.(report.sessionId) === true) {
          deps.log.info("push_skipped", { reason: "working again", type: "done", sessionId: report.sessionId });
          return;
        }
        onDone(deps, report);
      }, delay));
    },
    close(): void {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}

export function createNotifier(deps: NotifierDeps): Notifier {
  const lastStatus = new Map<string, SessionStatus>();
  const quiet = createDoneQuiet(deps);
  const sent: SentRequests = new Map();
  const unsubscribe = deps.bus.subscribe((event) => {
    if (event.type === "session") onSession(deps, lastStatus, event.session);
    if (event.type !== "activity") return;
    if (isPendingRequest(event.activity)) onRequest(deps, sent, event.sessionId, event.activity);
    else if (isSettledRequest(event.activity)) onSettled(deps, sent, event.sessionId, event.activity);
  });
  return {
    done: (report): void => {
      quiet.schedule(report);
    },
    handOff: (sessionId, request): void => {
      if (deps.stillWaiting?.(sessionId, request.requestId) === false) {
        deps.log.info("push_skipped", { reason: "nothing waits", type: request.kind, sessionId });
        return;
      }
      // Same collapse id as the request push: the device swaps the stale Allow/Deny notification for this one.
      const body = `${HAND_OFF_LEAD}: ${requestBody(request)}`;
      push(deps, { type: requestType(request.kind), category: "TERMINAL", sessionId, body, requestId: null, replaces: requestCategory(request.kind) });
    },
    ping: async (sessionId, title, body) => ping(deps, sessionId, title, body),
    close: (): void => {
      unsubscribe();
      quiet.close();
    },
  };
}
