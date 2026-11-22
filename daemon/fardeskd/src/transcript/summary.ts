// The one-line session summary and header facts for the session list.
import type { Activity, ToolActivity } from "../contract/schema.js";
import { countOpenBackgroundTasks } from "./background.js";
import { isConversationLine } from "./lineTypes.js";
import type { ConversationLine, TranscriptLine } from "./lineTypes.js";
import { buildRows } from "./rows.js";
import { truncate } from "./text.js";
import { lastContextUsage } from "./usage.js";

export type TranscriptSummary = {
  title: string | null;
  summary: string;
  cwd: string | null;
  model: string | null;
  permissionMode: string | null;
  startedAt: string | null;
  updatedAt: string | null;
  pendingToolUse: boolean;
  /** Background tasks (run_in_background Bash, background agents, Monitors) launched and not yet finished. */
  backgroundTasks: number;
  contextTokens: number | null;
  cacheExpiresAt: string | null;
  lastTurnAt: string | null;
};

const SENTENCE_BREAK = /(?<=[.!?])\s+|\n+/;

function lastOf<T>(lines: readonly TranscriptLine[], pick: (line: TranscriptLine) => T | null): T | null {
  for (const line of lines.toReversed()) {
    const value = pick(line);
    if (value !== null) return value;
  }
  return null;
}

function titleOf(lines: readonly TranscriptLine[], source: "ai" | "custom"): string | null {
  return lastOf(lines, (line) => (line.type === "title" && line.source === source ? line.title : null));
}

function modeOf(line: TranscriptLine): string | null {
  if (line.type === "permission-mode") return line.permissionMode;
  return line.type === "user" ? line.permissionMode : null;
}

function lastSentence(text: string): string {
  const sentences = text
    .split(SENTENCE_BREAK)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
  return sentences.slice(-1).join("");
}

/** Rows `mapActivities(lines, { cwd })` already built for these same lines; reused when `cwd` is the one summarise derives. */
export type PrebuiltRows = { cwd: string; activities: readonly Activity[] };

export function summarise(lines: readonly TranscriptLine[], maxChars: number, prebuilt?: PrebuiltRows): TranscriptSummary {
  const main = lines.filter((line) => !(isConversationLine(line) && line.isSidechain));
  const conversation: ConversationLine[] = main.filter(isConversationLine);
  const cwd = lastOf(main, (line) => (isConversationLine(line) ? line.cwd : null));
  const reusable = prebuilt !== undefined && prebuilt.cwd === (cwd ?? "");
  const rows = reusable ? prebuilt.activities : buildRows(main, cwd ?? "").map((row) => row.activity);
  const lastTool = rows.findLast((activity): activity is ToolActivity => activity.kind === "tool");
  const lastReply = rows.findLast((activity) => activity.kind === "assistant");
  const running = lastTool?.status === "running";
  const sentence = lastReply === undefined ? "" : lastSentence(lastReply.text);
  const usage = lastContextUsage(main);
  return {
    title: titleOf(main, "custom") ?? titleOf(main, "ai"),
    summary: truncate(running ? lastTool.title : sentence, maxChars),
    cwd,
    model: lastOf(main, (line) => (line.type === "assistant" ? line.model : null)),
    permissionMode: lastOf(main, modeOf),
    startedAt: conversation.at(0)?.timestamp ?? null,
    updatedAt: conversation.at(-1)?.timestamp ?? null,
    pendingToolUse: running,
    backgroundTasks: countOpenBackgroundTasks(main),
    contextTokens: usage?.contextTokens ?? null,
    cacheExpiresAt: usage?.cacheExpiresAt ?? null,
    lastTurnAt: usage?.lastTurnAt ?? null,
  };
}
