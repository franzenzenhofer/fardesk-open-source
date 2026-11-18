// The one function that turns what we know about a session into the contract SessionSummary
// (the "Session status mapping" table in docs/DAEMON.md).
import type { ReplyMode, SessionLabel, SessionStatus, SessionSummary, WaitingReason } from "../contract/schema.js";
import type { TranscriptSummary } from "../transcript/index.js";
import type { LiveProcess } from "./claudeRegistry.js";
import { BYPASS_PERMISSIONS, knownPermissionMode } from "./permissionMode.js";

const WAITING_SUMMARIES: Record<WaitingReason, string> = { permission: "Needs approval", question: "Needs answer" };

export type PendingKind = WaitingReason;

export type StatusInput = {
  id: string;
  process: LiveProcess | null;
  summary: TranscriptSummary;
  transcriptMtimeMs: number | null;
  owned: boolean;
  ownedBusy: boolean;
  pendingKind: PendingKind | null;
  /** The Claude home of this process has `crossSessionInbound: "accept"`: bypass-mode sessions read their inbox. */
  crossSessionAccepted: boolean;
  /** The terminal can be typed into, so replies work without an inbox. */
  typable?: boolean;
  muted: boolean;
  label: SessionLabel;
};

export type SessionTimes = { startedAt: string; updatedAt: string };

export function resolveCwd(input: Pick<StatusInput, "process" | "summary">): string | null {
  return input.process?.cwd ?? input.summary.cwd;
}

function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

function newest(candidates: (number | null)[]): number | null {
  const known = candidates.filter((value): value is number => value !== null);
  return known.length === 0 ? null : Math.max(...known);
}

function parsedMs(iso: string | null): number | null {
  return iso === null ? null : Date.parse(iso);
}

export function resolveTimes(input: Pick<StatusInput, "process" | "summary" | "transcriptMtimeMs">): SessionTimes | null {
  const { process, summary, transcriptMtimeMs } = input;
  const startedAt = parsedMs(summary.startedAt) ?? process?.startedAt ?? transcriptMtimeMs;
  const updatedAt = newest([parsedMs(summary.updatedAt), process?.updatedAt ?? null, transcriptMtimeMs]);
  if (startedAt === null || updatedAt === null) return null;
  return { startedAt: isoOf(Math.min(startedAt, updatedAt)), updatedAt: isoOf(updatedAt) };
}

function titleOf(input: StatusInput, cwd: string): string {
  const lastSegment = cwd.split("/").findLast((part) => part !== "");
  return input.summary.title ?? input.process?.name ?? lastSegment ?? cwd;
}

function registryStatus(process: LiveProcess | null, busy: boolean): SessionStatus {
  if (process === null) return busy ? "working" : "idle";
  return process.status === "busy" || busy ? "working" : "idle";
}

function statusOf(input: StatusInput, waitingFor: WaitingReason | null): SessionStatus {
  const live = input.process !== null || input.owned;
  if (!live) return "ended";
  if (waitingFor !== null) return "waiting";
  return registryStatus(input.process, input.owned && input.ownedBusy);
}

function waitingOf(input: StatusInput): WaitingReason | null {
  if (input.process === null && !input.owned) return null;
  if (input.pendingKind !== null) return input.pendingKind;
  return input.process?.status === "waiting" ? "permission" : null;
}

function replyModeOf(input: StatusInput, status: SessionStatus): ReplyMode {
  if (status === "ended") return "resume";
  if (input.owned) return "composer";
  const hasInbox = input.process?.messagingSocketPath != null;
  const inboxReadable = input.summary.permissionMode !== BYPASS_PERMISSIONS || input.crossSessionAccepted;
  return (hasInbox && inboxReadable) || input.typable === true ? "composer" : "takeover";
}

export function buildSessionSummary(input: StatusInput, cwd: string, times: SessionTimes): SessionSummary {
  const waitingFor = waitingOf(input);
  const status = statusOf(input, waitingFor);
  const hasTmux = input.process?.tmux != null;
  return {
    id: input.id,
    title: titleOf(input, cwd),
    cwd,
    status,
    waitingFor,
    owned: input.owned,
    replyMode: replyModeOf(input, status),
    canStop: status === "working" && (input.owned || hasTmux),
    summary: waitingFor === null ? input.summary.summary : WAITING_SUMMARIES[waitingFor],
    model: input.summary.model,
    pid: input.process?.pid ?? null,
    muted: input.muted,
    label: input.label,
    permissionMode: knownPermissionMode(input.summary.permissionMode),
    contextTokens: input.summary.contextTokens,
    cacheExpiresAt: input.summary.cacheExpiresAt,
    startedAt: times.startedAt,
    updatedAt: times.updatedAt,
  };
}
