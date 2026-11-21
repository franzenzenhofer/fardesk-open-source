// The poll cycle of the session store: sync entries with the registry and the transcripts, then publish.
import type { SessionSummary } from "../contract/schema.js";
import { createTailer, finishedToolCalls, mapActivities, summarise } from "../transcript/index.js";
import type { TranscriptLine } from "../transcript/index.js";
import { buildSessionSummary, resolveCwd, resolveTimes } from "./status.js";
import { EMPTY_SUMMARY, cacheKeyOf, diffActivities, newEntry } from "./storeEntry.js";
import type { StoreContext, StoreEntry } from "./storeEntry.js";
import { readSummaryLines } from "./storeIo.js";
import { acceptsCrossSession } from "./crossSession.js";
import { isProcessAlive } from "./processes.js";
import { collectProcesses, collectTranscripts } from "./storeSources.js";
import type { HomedProcess } from "./storeSources.js";
import type { TranscriptRef } from "./transcriptFiles.js";

function buildFor(ctx: StoreContext, entry: StoreEntry): SessionSummary | null {
  const { deps } = ctx;
  const input = {
    id: entry.id,
    process: entry.process,
    summary: entry.summary ?? EMPTY_SUMMARY,
    transcriptMtimeMs: entry.ref?.mtimeMs ?? null,
    owned: deps.isOwned(entry.id),
    ownedBusy: deps.isBusy(entry.id),
    pendingKind: deps.pendingKind(entry.id),
    crossSessionAccepted: entry.home !== null && ctx.acceptingHomes.has(entry.home),
    muted: deps.isMuted(entry.id),
    label: deps.labelOf(entry.id),
    typable: entry.process !== null && (deps.isTypable?.(entry.process.pid) ?? false),
  };
  const cwd = resolveCwd(input);
  const times = resolveTimes(input);
  return entry.summary === null || cwd === null || times === null ? null : buildSessionSummary(input, cwd, times);
}

export function publishEntry(ctx: StoreContext, entry: StoreEntry): void {
  const next = buildFor(ctx, entry);
  entry.current = next;
  if (next === null || JSON.stringify(next) === entry.published) return;
  entry.published = JSON.stringify(next);
  ctx.deps.bus.publish({ type: "session", session: next });
}

function applyLines(ctx: StoreContext, entry: StoreEntry, lines: TranscriptLine[], cwd: string): void {
  entry.activities = mapActivities(lines, { cwd });
  entry.summary = summarise(lines, ctx.deps.summaryMaxChars, { cwd, activities: entry.activities });
}

/** Reports each tool call the first time its tool_result shows up (calls already finished at start are only remembered). */
function reportFinishedCalls(ctx: StoreContext, entry: StoreEntry, lines: TranscriptLine[], silent = false): void {
  for (const call of finishedToolCalls(lines)) {
    if (entry.finishedCallIds.has(call.id)) continue;
    entry.finishedCallIds.add(call.id);
    if (!silent) ctx.deps.onToolFinished?.(entry.id, call);
  }
}

function startTailer(ctx: StoreContext, entry: StoreEntry, path: string, cwd: string): void {
  entry.tailer?.close();
  entry.tailerPath = path;
  const tailer = createTailer({
    path,
    pollMs: ctx.deps.transcriptPollMs,
    onLines: () => {
      const previous = entry.activities;
      applyLines(ctx, entry, tailer.lines(), cwd);
      for (const activity of diffActivities(previous, entry.activities)) {
        ctx.deps.bus.publish({ type: "activity", sessionId: entry.id, activity });
      }
      reportFinishedCalls(ctx, entry, tailer.lines());
      publishEntry(ctx, entry);
    },
  });
  entry.tailer = tailer;
  entry.finishedCallIds = new Set();
  applyLines(ctx, entry, tailer.lines(), cwd);
  reportFinishedCalls(ctx, entry, tailer.lines(), true);
}

export function stopTailer(entry: StoreEntry): void {
  entry.tailer?.close();
  entry.tailer = null;
  entry.tailerPath = null;
  entry.activities = [];
}

function syncLive(ctx: StoreContext, entry: StoreEntry, live: HomedProcess, ref: TranscriptRef | null): void {
  const { process, home } = live;
  entry.home = home;
  entry.process = process;
  entry.ref = ref;
  if (ref !== null && entry.tailerPath !== ref.path) startTailer(ctx, entry, ref.path, process.cwd);
  entry.summary ??= EMPTY_SUMMARY;
}

function syncEnded(ctx: StoreContext, entry: StoreEntry, ref: TranscriptRef, budget: { reads: number }): void {
  entry.home = null;
  entry.process = null;
  entry.ref = ref;
  stopTailer(entry);
  const key = cacheKeyOf(ref);
  if (key === entry.cacheKey || budget.reads <= 0) return;
  budget.reads -= 1;
  entry.cacheKey = key;
  entry.summary = summarise(readSummaryLines(ref), ctx.deps.summaryMaxChars);
}

const MISSED_POLLS_BEFORE_GONE = 2;

/**
 * A live process missing from one poll may only be a registry file that could not be parsed (a partial write), so
 * it counts as gone when its pid is really dead or it stayed missing for two polls in a row.
 */
function goneConfirmed(entry: StoreEntry): boolean {
  entry.missedPolls += 1;
  const confirmed = entry.missedPolls >= MISSED_POLLS_BEFORE_GONE || entry.lastPid === null || !isProcessAlive(entry.lastPid);
  if (confirmed) entry.missedPolls = 0;
  return confirmed;
}

function leftWaiting(entry: StoreEntry): boolean {
  const waiting = entry.process?.status === "waiting";
  const live = entry.process !== null;
  if (entry.process !== null) {
    entry.missedPolls = 0;
    entry.lastPid = entry.process.pid;
  } else if (entry.wasLive && !goneConfirmed(entry)) {
    return false;
  }
  const left = (entry.wasWaiting && !waiting) || (entry.wasLive && !live);
  entry.wasWaiting = waiting;
  entry.wasLive = live;
  return left;
}

function entryFor(ctx: StoreContext, id: string): StoreEntry {
  const entry = ctx.entries.get(id) ?? newEntry(id);
  ctx.entries.set(id, entry);
  return entry;
}

export function refreshStore(ctx: StoreContext): void {
  const { deps, entries } = ctx;
  ctx.acceptingHomes = new Set(deps.claudeHomes.filter(acceptsCrossSession));
  const processes = collectProcesses(deps.claudeHomes);
  const transcripts = collectTranscripts(deps.claudeHomes, new Set(processes.keys()), deps.limits.maxEnded);
  const budget = { reads: deps.limits.maxEndedReadsPerRefresh };
  for (const [id, process] of processes) syncLive(ctx, entryFor(ctx, id), process, transcripts.get(id) ?? null);
  for (const [id, ref] of transcripts) if (!processes.has(id)) syncEnded(ctx, entryFor(ctx, id), ref, budget);
  const gone = [...entries.values()].filter((entry) => !processes.has(entry.id) && !transcripts.has(entry.id));
  for (const entry of gone) {
    entry.process = null;
    stopTailer(entry);
  }
  const left = [...entries.values()].filter(leftWaiting).map((entry) => entry.id);
  for (const entry of gone) if (entry.missedPolls === 0) entries.delete(entry.id);
  for (const entry of entries.values()) publishEntry(ctx, entry);
  for (const id of left) deps.onLeftWaiting(id);
}
