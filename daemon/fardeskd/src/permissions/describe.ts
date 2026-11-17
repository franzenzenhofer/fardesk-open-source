import { z } from "zod";
import { FardeskError } from "../core/errors.js";

export const SUMMARY_MAX_LENGTH = 200;
const ELLIPSIS = "...";
const MCP_PREFIX = "mcp";
const MCP_SEPARATOR = "__";
const MCP_MIN_PARTS = 3;
const ASK_USER_QUESTION = "AskUserQuestion";
const EDIT_TOOLS: readonly string[] = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

export const DESTRUCTIVE_PATTERNS = {
  rm: /\brm\s+(?:\S+\s+)*?(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)(?:\s|$)/,
  sudo: /\bsudo\b/,
  gitForcePush: /\bgit\s+push\b[^|;&]*\s(?:--force(?:-with-lease)?|-f)(?:[\s=]|$)/,
  gitResetHard: /\bgit\s+reset\b[^|;&]*--hard\b/,
  gitCleanForce: /\bgit\s+clean\b[^|;&]*\s-[a-zA-Z]*f/,
  mkfs: /(?:^|[\s;&|])mkfs(?:\.\w+)?(?:\s|$)/,
  dd: /\bdd\b[^|;&]*\bof=/,
  recursiveOwnership: /\b(?:chmod|chown)\s+(?:\S+\s+)*?(?:-[a-zA-Z]*R[a-zA-Z]*|--recursive)(?:\s|$)/,
  kill9: /\bkill\s+(?:\S+\s+)*?-(?:9|KILL|SIGKILL)(?:\s|$)/,
  dropSql: /\bdrop\s+(?:table|database)\b/i,
  truncate: /(?:^|[\s;&|])truncate(?:\s|$)/,
  pipeToShell: /\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:sh|bash)\b/,
} as const satisfies Record<string, RegExp>;

const questionSchema = z.looseObject({
  question: z.string().min(1),
  options: z.array(z.looseObject({ label: z.string().min(1) })),
});

const askUserQuestionSchema = z.looseObject({
  questions: z.tuple([questionSchema], questionSchema),
});

export type ParsedAskUserQuestion = {
  questions: unknown[];
  text: string;
  options: string[];
};

export type RequestDescription =
  | { kind: "permission"; title: string; summary: string; destructive: boolean }
  | { kind: "question"; text: string; options: string[] };

export function parseAskUserQuestion(toolInput: unknown): ParsedAskUserQuestion {
  const parsed = askUserQuestionSchema.safeParse(toolInput);
  if (!parsed.success) {
    throw new FardeskError("invalid_request", `malformed AskUserQuestion input: ${parsed.error.message}`);
  }
  const { questions } = parsed.data;
  const [first] = questions;
  return { questions, text: first.question, options: first.options.map((option) => option.label) };
}

function stringField(input: unknown, key: string): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function serialize(input: unknown): string {
  if (input === undefined) return "";
  return JSON.stringify(input);
}

function compactJson(input: unknown): string {
  const json = serialize(input);
  return json.length > SUMMARY_MAX_LENGTH ? `${json.slice(0, SUMMARY_MAX_LENGTH)}${ELLIPSIS}` : json;
}

type PermissionDescription = Extract<RequestDescription, { kind: "permission" }>;

function permission(title: string, summary: string | undefined, input: unknown): PermissionDescription {
  return { kind: "permission", title, summary: summary ?? compactJson(input), destructive: false };
}

function describeBash(input: unknown): PermissionDescription {
  const command = stringField(input, "command");
  const destructive = command !== undefined && Object.values(DESTRUCTIVE_PATTERNS).some((p) => p.test(command));
  return { ...permission("Allow command?", command, input), destructive };
}

function describeMcp(toolName: string, input: unknown): RequestDescription | null {
  const parts = toolName.split(MCP_SEPARATOR);
  const [prefix, server] = parts;
  if (prefix !== MCP_PREFIX || parts.length < MCP_MIN_PARTS) return null;
  return permission(`Allow ${parts.slice(2).join(MCP_SEPARATOR)}?`, server, input);
}

export function describeRequest(toolName: string, toolInput: unknown): RequestDescription {
  if (toolName === ASK_USER_QUESTION) {
    const { text, options } = parseAskUserQuestion(toolInput);
    return { kind: "question", text, options };
  }
  if (toolName === "Bash") return describeBash(toolInput);
  if (EDIT_TOOLS.includes(toolName)) {
    const path = stringField(toolInput, "file_path") ?? stringField(toolInput, "notebook_path");
    return permission("Allow edit?", path, toolInput);
  }
  if (toolName === "WebFetch") return permission("Allow fetch?", stringField(toolInput, "url"), toolInput);
  return describeMcp(toolName, toolInput) ?? permission(`Allow ${toolName}?`, undefined, toolInput);
}
