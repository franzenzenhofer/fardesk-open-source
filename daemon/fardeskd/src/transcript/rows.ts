// Pass 2: turn each tool call into a tool row (or an answered question), then merge runs.
import { z } from "zod";
import type { Activity, ToolActivity } from "../contract/schema.js";
import { collect } from "./collect.js";
import type { Item } from "./collect.js";
import type { TranscriptLine } from "./lineTypes.js";
import { mergeRuns } from "./merge.js";
import type { Row } from "./rowTypes.js";
import { toolTitle } from "./titles.js";
import { detailKind, outputOfCall, ownDurationMs } from "./toolCalls.js";
import type { ToolCall, ToolResult } from "./toolCalls.js";

export const QUESTION_TOOL = "AskUserQuestion";

const questionSchema = z.looseObject({
  question: z.string().min(1),
  options: z.array(z.looseObject({ label: z.string().min(1) })).default([]),
});
const questionInputSchema = z.looseObject({ questions: z.tuple([questionSchema], questionSchema) });

function statusOf(call: ToolCall, running: boolean): ToolActivity["status"] {
  if (call.result === null) return running ? "running" : "error";
  return call.result.isError ? "error" : "ok";
}

function durationOf(call: ToolCall): number | null {
  if (call.result === null) return null;
  const own = ownDurationMs(call.result);
  if (own !== null) return Math.max(0, Math.round(own));
  return Math.max(0, Date.parse(call.result.timestamp) - Date.parse(call.timestamp));
}

function questionRow(call: ToolCall, result: ToolResult): Row | null {
  const parsed = questionInputSchema.safeParse(call.input);
  if (!parsed.success) return null;
  const [first] = parsed.data.questions;
  const activity: Activity = {
    kind: "question",
    id: call.id,
    ts: call.timestamp,
    requestId: call.id,
    text: first.question,
    options: first.options.map((option) => option.label),
    state: result.isError || result.denied ? "expired" : "answered",
  };
  return { activity, title: "", members: [call], detail: null };
}

function toolRow(call: ToolCall, running: boolean): Row {
  const status = statusOf(call, running);
  const detail = detailKind(call);
  const title = toolTitle(call, {
    status,
    denied: call.result?.denied ?? false,
    output: outputOfCall(call),
  });
  const activity: Activity = {
    kind: "tool",
    id: call.id,
    ts: call.timestamp,
    tool: call.name,
    title,
    status,
    hasDetail: detail !== null,
    durationMs: durationOf(call),
  };
  return { activity, title, members: [call], detail };
}

// An unanswered question yields no row: the live pending card comes from the permission broker.
function resolve(item: Item, lastMoveSeq: number): Row | null {
  if (item.type === "activity") return { activity: item.activity, title: "", members: [], detail: null };
  const { call } = item;
  if (call.name !== QUESTION_TOOL) return toolRow(call, lastMoveSeq < call.seq);
  return call.result === null ? null : (questionRow(call, call.result) ?? toolRow(call, false));
}

export function buildRows(lines: readonly TranscriptLine[], cwd: string): Row[] {
  const { items, lastMoveSeq } = collect(lines);
  const rows = items.flatMap((item) => {
    const row = resolve(item, lastMoveSeq);
    return row === null ? [] : [row];
  });
  return mergeRuns(rows, cwd);
}
