// Collapses runs of consecutive completed lookups and consecutive successful edits into one row.
// A run is only broken by a row that is not part of it (text, a user prompt, a running or failed
// tool, another group), so "nothing but skipped lines in between" holds by construction.
import type { ToolActivity } from "../contract/schema.js";
import type { Row } from "./rowTypes.js";
import { plural, relativeToCwd } from "./text.js";
import { DIFF_TOOLS, LOOKUP_TOOLS, field } from "./toolCalls.js";
import type { ToolCall } from "./toolCalls.js";

type Group = "lookup" | "edit";
type Run = { group: Group; head: Row; headActivity: ToolActivity; rest: Row[] };

export function lookupTarget(call: ToolCall, cwd: string): string {
  switch (call.name) {
    case "Read":
      return relativeToCwd(field(call.input, "file_path"), cwd);
    case "ToolSearch":
      return `ToolSearch: ${field(call.input, "query")}`;
    default:
      return `${call.name}: ${field(call.input, "pattern")}`;
  }
}

export function editedPath(call: ToolCall): string {
  return field(call.input, "file_path");
}

function distinct(values: string[]): string[] {
  return [...new Set(values)];
}

function groupOf(activity: ToolActivity): Group | null {
  if (activity.status !== "ok") return null;
  if (LOOKUP_TOOLS.includes(activity.tool)) return "lookup";
  return DIFF_TOOLS.includes(activity.tool) ? "edit" : null;
}

function mergeLookups(run: Run, members: ToolCall[], cwd: string): Row {
  const count = distinct(members.map((call) => lookupTarget(call, cwd))).length;
  const title = `Looked through ${count} ${plural(count, "file", "files")}`;
  const activity: ToolActivity = { ...run.headActivity, tool: "Read", title, hasDetail: true, durationMs: null };
  return { activity, title, members, detail: "lookup" };
}

function mergeEdits(run: Run, members: ToolCall[], cwd: string): Row {
  const paths = distinct(members.map(editedPath));
  if (paths.length === 1) {
    const hasDiff = [run.head, ...run.rest].some((row) => row.detail === "diff");
    const activity: ToolActivity = { ...run.headActivity, hasDetail: hasDiff, durationMs: null };
    return { activity, title: run.head.title, members, detail: hasDiff ? "diff" : null };
  }
  const { id, ts } = run.headActivity;
  const changed = paths.map((path) => relativeToCwd(path, cwd));
  const title = `Edited ${paths.length} files`;
  return { activity: { kind: "files", id, ts, title, changed }, title, members, detail: "diff" };
}

function closeRun(run: Run | null, cwd: string): Row[] {
  if (run === null) return [];
  if (run.rest.length === 0) return [run.head];
  const members = [run.head, ...run.rest].flatMap((row) => row.members);
  return [run.group === "lookup" ? mergeLookups(run, members, cwd) : mergeEdits(run, members, cwd)];
}

function startRun(row: Row): Run | null {
  const { activity } = row;
  if (activity.kind !== "tool") return null;
  const group = groupOf(activity);
  return group === null ? null : { group, head: row, headActivity: activity, rest: [] };
}

function joins(run: Run, row: Row): boolean {
  return row.activity.kind === "tool" && groupOf(row.activity) === run.group;
}

export function mergeRuns(rows: readonly Row[], cwd: string): Row[] {
  const out: Row[] = [];
  let run: Run | null = null;
  for (const row of rows) {
    if (run !== null && joins(run, row)) {
      run.rest.push(row);
      continue;
    }
    out.push(...closeRun(run, cwd));
    run = startRun(row);
    if (run === null) out.push(row);
  }
  return [...out, ...closeRun(run, cwd)];
}

