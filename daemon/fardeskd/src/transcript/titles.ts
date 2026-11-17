// One human-sized title per tool call. Pure and table-driven; no backticks, no em or en dashes.
import type { ToolActivity } from "../contract/schema.js";
import { testSummarySuffix } from "./testSummary.js";
import { baseName, cleanForTitle, firstLine, truncate } from "./text.js";
import { field } from "./toolCalls.js";

export const COMMAND_TITLE_MAX = 48;
export const SUBJECT_TITLE_MAX = 60;
const MCP_PREFIX = "mcp__";
const MCP_SEPARATOR = "__";

export type TitleContext = {
  status: ToolActivity["status"];
  denied: boolean;
  output: string;
};

type Named = { name: string; input: Record<string, unknown> };

function commandOf(input: Record<string, unknown>): string {
  return truncate(cleanForTitle(firstLine(field(input, "command"))), COMMAND_TITLE_MAX);
}

function subject(value: string): string {
  return truncate(cleanForTitle(value), SUBJECT_TITLE_MAX);
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : subject(url);
}

function mcpTitle(name: string): string {
  const parts = name.slice(MCP_PREFIX.length).split(MCP_SEPARATOR);
  return `${parts.slice(1).join(MCP_SEPARATOR)} (${parts.slice(0, 1).join("")})`;
}

function bashTitle(input: Record<string, unknown>, context: TitleContext): string {
  const command = commandOf(input);
  if (context.status === "running") return `Running ${command}...`;
  if (context.status === "error") return `Failed ${command}`;
  return `Ran ${command}${testSummarySuffix(context.output)}`;
}

// What the call acted on: the shared noun of both the normal and the "Denied: ..." title.
export function subjectOf({ name, input }: Named): string {
  switch (name) {
    case "Bash":
      return commandOf(input);
    case "Edit":
    case "MultiEdit":
    case "Write":
    case "Read":
      return baseName(field(input, "file_path"));
    case "Grep":
    case "Glob":
      return subject(field(input, "pattern"));
    case "Agent":
      return subject(field(input, "description"));
    case "WebFetch":
      return hostOf(field(input, "url"));
    case "WebSearch":
      return subject(field(input, "query"));
    default:
      return name.startsWith(MCP_PREFIX) ? mcpTitle(name) : name;
  }
}

export function toolTitle(call: Named, context: TitleContext): string {
  if (context.denied) return `Denied: ${subjectOf(call)}`;
  const { name, input } = call;
  const what = subjectOf(call);
  switch (name) {
    case "Bash":
      return bashTitle(input, context);
    case "Edit":
    case "MultiEdit":
      return `Edited ${what}`;
    case "Write":
      return `Wrote ${what}`;
    case "Read":
      return `Read ${what}`;
    case "Grep":
      return `Searched for ${what}`;
    case "Glob":
      return `Listed ${what}`;
    case "Agent":
      return `Agent: ${what}`;
    case "WebFetch":
      return `Fetched ${what}`;
    case "WebSearch":
      return `Searched the web for ${what}`;
    default:
      return name.startsWith(MCP_PREFIX) ? what : `Used ${name}`;
  }
}
