// On-demand detail of one feed row: a diff (edits), a listing (merged lookups) or an output tail.
import type { ActivityDetail, DetailLine, DetailSection } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { diffSections } from "./diff.js";
import type { TranscriptLine } from "./lineTypes.js";
import { lookupTarget } from "./merge.js";
import type { Row } from "./rowTypes.js";
import { buildRows } from "./rows.js";
import { cleanForTitle, firstLine, splitLines, truncate } from "./text.js";
import { field, outputOfCall } from "./toolCalls.js";

export const OUTPUT_TITLE_MAX = 120;

export type DetailOptions = { cwd: string; maxOutputLines: number; maxDiffLines: number };

function plainLines(texts: readonly string[]): DetailLine[] {
  return texts.map((text) => ({ number: null, sign: " ", text }));
}

function sectionOf(title: string, lines: DetailLine[]): DetailSection {
  return { title, subtitle: "", added: 0, removed: 0, lines };
}

// Bash shows the command, everything else the row title.
function outputTitle(row: Row): string {
  const command = cleanForTitle(firstLine(row.members.map((call) => field(call.input, "command")).join("\n")));
  return command === "" ? row.title : truncate(command, OUTPUT_TITLE_MAX);
}

function outputDetail(row: Row, id: string, options: DetailOptions): ActivityDetail {
  const text = row.members.map(outputOfCall).join("\n");
  const all = splitLines(text);
  const kept = all.slice(-options.maxOutputLines);
  const section = sectionOf(outputTitle(row), plainLines(kept));
  return { activityId: id, kind: "output", truncated: kept.length < all.length, sections: [section] };
}

function lookupDetail(row: Row, id: string, options: DetailOptions): ActivityDetail {
  const targets = [...new Set(row.members.map((call) => lookupTarget(call, options.cwd)))];
  const kept = targets.slice(0, options.maxOutputLines);
  const section = sectionOf(row.title, plainLines(kept));
  return { activityId: id, kind: "output", truncated: kept.length < targets.length, sections: [section] };
}

export function buildDetail(lines: readonly TranscriptLine[], activityId: string, options: DetailOptions): ActivityDetail {
  const row = buildRows(lines, options.cwd).find((candidate) => candidate.activity.id === activityId);
  if (row === undefined) throw new FardeskError("not_found", `No activity ${activityId}`);
  switch (row.detail) {
    case "diff": {
      const { sections, truncated } = diffSections(row.members, options.cwd, options.maxDiffLines);
      return { activityId, kind: "diff", truncated, sections };
    }
    case "lookup":
      return lookupDetail(row, activityId, options);
    case "output":
      return outputDetail(row, activityId, options);
    case null:
      throw new FardeskError("not_found", `Activity ${activityId} has no detail`);
  }
}
