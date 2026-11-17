// A tool_use joined with its tool_result, plus typed readers for the parts of
// `toolUseResult` and `input` the feed understands.
import { z } from "zod";
import type { ToolResultBlock, UserLine } from "./lineTypes.js";

export type ToolResult = {
  isError: boolean;
  denied: boolean;
  text: string;
  structured: unknown;
  timestamp: string;
};

export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
  seq: number;
  result: ToolResult | null;
};

export const DIFF_TOOLS: readonly string[] = ["Edit", "MultiEdit", "Write"];
export const LOOKUP_TOOLS: readonly string[] = ["Read", "Grep", "Glob", "ToolSearch"];

const outputSchema = z.looseObject({ stdout: z.string().optional(), stderr: z.string().optional() });
const durationSchema = z.looseObject({ durationMs: z.number() });
const hunkSchema = z.looseObject({
  oldStart: z.number().int(),
  newStart: z.number().int(),
  lines: z.array(z.string()),
});
const diffResultSchema = z.looseObject({
  filePath: z.string(),
  structuredPatch: z.array(hunkSchema),
  content: z.string().optional(),
});

export type Hunk = z.infer<typeof hunkSchema>;
export type DiffResult = z.infer<typeof diffResultSchema>;

export function field(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  return typeof value === "string" ? value : "";
}

export function resultFromBlock(line: UserLine, block: ToolResultBlock): ToolResult {
  return {
    isError: block.isError,
    denied: line.denialKind !== null,
    text: block.text,
    structured: line.toolUseResult,
    timestamp: line.timestamp,
  };
}

export function diffOf(call: ToolCall): DiffResult | null {
  if (call.result === null) return null;
  const parsed = diffResultSchema.safeParse(call.result.structured);
  return parsed.success ? parsed.data : null;
}

export function resultOutput(result: ToolResult): string {
  const parsed = outputSchema.safeParse(result.structured);
  if (!parsed.success || (parsed.data.stdout === undefined && parsed.data.stderr === undefined)) return result.text;
  return [parsed.data.stdout ?? "", parsed.data.stderr ?? ""]
    .map((part) => part.replace(/\n+$/, ""))
    .filter((part) => part !== "")
    .join("\n");
}

export function outputOfCall(call: ToolCall): string {
  return call.result === null ? "" : resultOutput(call.result);
}

export function ownDurationMs(result: ToolResult): number | null {
  const parsed = durationSchema.safeParse(result.structured);
  return parsed.success ? parsed.data.durationMs : null;
}

export type DetailKind = "diff" | "output";

function hasDiffContent(diff: DiffResult | null): boolean {
  return diff !== null && (diff.structuredPatch.length > 0 || (diff.content ?? "") !== "");
}

export function detailKind(call: ToolCall): DetailKind | null {
  const { result } = call;
  if (result === null || result.denied) return null;
  if (DIFF_TOOLS.includes(call.name) && !result.isError) return hasDiffContent(diffOf(call)) ? "diff" : null;
  return resultOutput(result).trim() === "" ? null : "output";
}
