// message, stop and kill: owned sessions go through the runner; terminal sessions through their tmux pane,
// inbox socket or process id.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { composeText, imageBlocks } from "../attachments/compose.js";
import type { AttachmentStore } from "../attachments/store.js";
import type { RunCommand, RunWithInput } from "../config/bind.js";
import type { Config } from "../config/config.js";
import type { ClosedTarget } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { confirmDelivery, type MessageOutcome } from "../foreign/delivery.js";
import { INBOX_FROM_LABEL, postToInbox } from "../foreign/inbox.js";
import type { Ghostty } from "../foreign/ghostty.js";
import type { Logger } from "../core/log.js";
import { terminate } from "../foreign/terminate.js";
import { sendEscape } from "../foreign/tmux.js";
import type { OwnedRunner } from "../owned/types.js";
import { isProcessAlive } from "../sessions/processes.js";
import type { SessionRecord, SessionStore } from "../sessions/store.js";
import type { ClearTerminal } from "./clear.js";
import { clearTerminalSession, compactTerminalSession, rejectClearMessage, rejectCompactMessage } from "./clear.js";
import { closePlacement, locate, typeIntoPane } from "./terminal.js";
import type { Placement, TerminalDeps } from "./terminal.js";
import type { ActionResult, Services } from "./types.js";

export type ActionDeps = {
  config: Pick<Config, "delivery" | "kill" | "tmuxBinary" | "claudeHomes" | "name">;
  store: SessionStore;
  owned: OwnedRunner;
  run: RunCommand;
  runWithInput: RunWithInput;
  attachments: AttachmentStore;
  ghostty: Ghostty;
  log: Logger;
};

export type Actions = Pick<Services, "message" | "stop" | "kill" | "clear" | "compact">;

const NEWLINE = "\n";

function sizeOf(path: string | null): number {
  return path === null ? 0 : statSync(path).size;
}

// The lines appended to a transcript after `offset` bytes.
function readAppended(path: string, offset: number): string[] {
  const length = statSync(path).size - offset;
  if (length <= 0) return [];
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    return buffer.subarray(0, readSync(fd, buffer, 0, length, offset)).toString("utf8").split(NEWLINE);
  } finally {
    closeSync(fd);
  }
}

export function terminalDeps(deps: ActionDeps): TerminalDeps {
  return { tmuxBinary: deps.config.tmuxBinary, run: deps.run, runWithInput: deps.runWithInput, ghostty: deps.ghostty, log: deps.log };
}

function requireComposer(record: SessionRecord): void {
  if (record.summary.replyMode !== "composer") {
    throw new FardeskError(
      "conflict",
      `session ${record.summary.id} cannot take messages from Fardesk (${record.summary.replyMode}): take it over or resume it first`,
    );
  }
}

// Typed input would answer an open permission or question dialog, so a waiting session must not get it.
export function requireNotWaiting(record: SessionRecord): void {
  if (record.summary.waitingFor !== null) {
    throw new FardeskError("conflict", `session ${record.summary.id} is waiting for a ${record.summary.waitingFor} answer: answer it before sending text`);
  }
}

// True when the text was typed into the terminal; false when Ghostty could not be driven and the inbox must take it.
async function typeIntoGhostty(deps: ActionDeps, terminalId: string, text: string, sessionId: string): Promise<boolean> {
  try {
    await deps.ghostty.type(terminalId, text);
    return true;
  } catch (error) {
    deps.log.warn("ghostty_type_failed_using_inbox", { sessionId, automation: deps.ghostty.status(), error: (error as Error).message });
    return false;
  }
}

// tmux send-keys > Ghostty AppleScript > inbox socket.
async function deliver(deps: ActionDeps, record: SessionRecord, text: string): Promise<void> {
  const pid = record.process?.pid ?? null;
  const placement: Placement = pid === null ? { kind: "none" } : await locate(terminalDeps(deps), pid);
  if (placement.kind === "pane") {
    requireNotWaiting(record);
    await typeIntoPane(terminalDeps(deps), placement, text);
    return;
  }
  if (placement.kind === "ghostty") {
    requireNotWaiting(record);
    if (await typeIntoGhostty(deps, placement.terminalId, text, record.summary.id)) return;
  }
  const socketPath = record.process?.messagingSocketPath ?? null;
  if (socketPath === null) {
    requireComposer(record);
    throw new FardeskError("conflict", `session ${record.summary.id} has no inbox and its terminal cannot be typed into: take it over or resume it first`);
  }
  requireComposer(record);
  // Claude Code feeds an inbox message into an open permission or question dialog too: its first line becomes the
  // dialog's answer and the rest (the "Attached image:" lines) is lost. A waiting session gets nothing.
  requireNotWaiting(record);
  await postToInbox({ socketPath, text, from: INBOX_FROM_LABEL });
}

async function postAndConfirm(deps: ActionDeps, record: SessionRecord, text: string): Promise<MessageOutcome> {
  const { id } = record.summary;
  const busy = record.summary.status === "working";
  const startPath = record.transcriptPath;
  const startSize = sizeOf(startPath);
  await deliver(deps, record, text);
  const readLines = (): string[] => {
    const path = deps.store.find(id)?.transcriptPath ?? null;
    if (path === null) return [];
    return readAppended(path, path === startPath ? startSize : 0);
  };
  const { timeoutMs, pollMs } = deps.config.delivery;
  return confirmDelivery({ readLines, text, timeoutMs, pollMs, busy, sessionId: id });
}

async function sendMessage(deps: ActionDeps, sessionId: string, text: string, attachmentIds: string[]): Promise<MessageOutcome> {
  rejectClearMessage(text);
  rejectCompactMessage(text);
  const owned = deps.owned.isOwned(sessionId);
  const record = owned ? null : deps.store.get(sessionId);
  const attached = deps.attachments.resolve(sessionId, attachmentIds);
  const composed = composeText(text, attached);
  if (record === null) {
    deps.owned.send(sessionId, composed, imageBlocks(attached));
    return "delivered";
  }
  return postAndConfirm(deps, record, composed);
}

async function stopSession(deps: ActionDeps, sessionId: string): Promise<void> {
  if (deps.owned.isOwned(sessionId)) {
    await deps.owned.interrupt(sessionId);
    return;
  }
  const { process } = deps.store.get(sessionId);
  // The registry names a pane without its server; the process tree knows which tmux server really holds it.
  const placement = process === null ? null : await locate(terminalDeps(deps), process.pid);
  if (placement?.kind === "pane") {
    await sendEscape({ tmuxBinary: deps.config.tmuxBinary, pane: placement.pane, socket: placement.socket, run: deps.run });
    return;
  }
  const pane = process?.tmux ?? null;
  if (pane === null) {
    throw new FardeskError("unsupported", `session ${sessionId} is not owned and does not run in tmux: it cannot be stopped, only killed or taken over`);
  }
  await sendEscape({ tmuxBinary: deps.config.tmuxBinary, pane, run: deps.run });
}

async function killSession(deps: ActionDeps, sessionId: string, closeTab: boolean): Promise<ClosedTarget> {
  if (deps.owned.isOwned(sessionId)) {
    await deps.owned.stop(sessionId);
    deps.store.refresh();
    return "none";
  }
  const { process } = deps.store.get(sessionId);
  if (process === null) throw new FardeskError("conflict", `session ${sessionId} has already ended`);
  const placement: Placement = closeTab ? await locate(terminalDeps(deps), process.pid) : { kind: "none" };
  await terminate({ pid: process.pid, signal: "SIGTERM", ...deps.config.kill, isAlive: isProcessAlive });
  const closed = await closePlacement(terminalDeps(deps), placement);
  deps.store.refresh();
  return closed;
}

function clearDeps(deps: ActionDeps): ClearTerminal {
  return { terminal: terminalDeps(deps), claudeHomes: deps.config.claudeHomes, machineName: deps.config.name, requireNotWaiting };
}

async function clearSession(deps: ActionDeps, sessionId: string): Promise<ActionResult> {
  if (deps.owned.isOwned(sessionId)) {
    const next = await deps.owned.clear(sessionId);
    deps.store.refresh();
    return { sessionId: next };
  }
  const terminal = clearDeps(deps);
  const next = await clearTerminalSession(terminal, deps.store.get(sessionId));
  deps.store.refresh();
  return { sessionId: next };
}

async function compactSession(deps: ActionDeps, sessionId: string): Promise<ActionResult> {
  if (!deps.owned.isOwned(sessionId)) {
    const record = deps.store.get(sessionId);
    if (record.summary.status !== "ended") {
      await compactTerminalSession(clearDeps(deps), record);
      deps.store.refresh();
      return { sessionId };
    }
    await deps.owned.resume(sessionId);
  }
  await deps.owned.compact(sessionId);
  deps.store.refresh();
  return { sessionId };
}

export function createActions(deps: ActionDeps): Actions {
  return {
    message: async (sessionId, text, attachmentIds = []) => sendMessage(deps, sessionId, text, attachmentIds),
    stop: async (sessionId) => stopSession(deps, sessionId),
    kill: async (sessionId, closeTab = false) => killSession(deps, sessionId, closeTab),
    clear: async (sessionId) => clearSession(deps, sessionId),
    compact: async (sessionId) => compactSession(deps, sessionId),
  };
}
