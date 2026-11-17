// Diff sections from Claude Code's own `structuredPatch` (real hunks, real line numbers).
import type { DetailLine, DetailSection } from "../contract/schema.js";
import { baseName, dirOf, splitLines } from "./text.js";
import { diffOf } from "./toolCalls.js";
import type { Hunk, ToolCall } from "./toolCalls.js";
import { editedPath } from "./merge.js";

type Sign = DetailLine["sign"];

function hunkLines(hunk: Hunk): DetailLine[] {
  let oldNumber = hunk.oldStart;
  let newNumber = hunk.newStart;
  return hunk.lines.map((line) => {
    const head = line.slice(0, 1);
    const text = line.slice(1);
    if (head === "+") return { number: newNumber++, sign: "+", text };
    if (head === "-") return { number: oldNumber++, sign: "-", text };
    oldNumber += 1;
    return { number: newNumber++, sign: " ", text };
  });
}

function createdLines(content: string): DetailLine[] {
  return splitLines(content).map((text, index) => ({ number: index + 1, sign: "+", text }));
}

function linesOfCall(call: ToolCall): DetailLine[] {
  const diff = diffOf(call);
  if (diff === null) return [];
  if (diff.structuredPatch.length > 0) return diff.structuredPatch.flatMap(hunkLines);
  return createdLines(diff.content ?? "");
}

function count(lines: DetailLine[], sign: Sign): number {
  return lines.filter((line) => line.sign === sign).length;
}

function callsByFile(members: readonly ToolCall[]): Map<string, ToolCall[]> {
  const byFile = new Map<string, ToolCall[]>();
  for (const call of members) byFile.set(editedPath(call), [...(byFile.get(editedPath(call)) ?? []), call]);
  return byFile;
}

export type DiffSections = { sections: DetailSection[]; truncated: boolean };

export function diffSections(members: readonly ToolCall[], cwd: string, maxLines: number): DiffSections {
  const sections: DetailSection[] = [];
  let truncated = false;
  for (const [path, calls] of callsByFile(members)) {
    const lines = calls.flatMap(linesOfCall);
    if (lines.length === 0) continue;
    truncated ||= lines.length > maxLines;
    sections.push({
      title: baseName(path),
      subtitle: dirOf(path, cwd),
      added: count(lines, "+"),
      removed: count(lines, "-"),
      lines: lines.slice(0, maxLines),
    });
  }
  return { sections, truncated };
}
