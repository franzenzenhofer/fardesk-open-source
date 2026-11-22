// The small, normalised shape of a transcript line: only what the activity feed needs.
import type { LineUsage } from "./usage.js";

export type TextBlock = { type: "text"; text: string };
export type ImageBlock = { type: "image" };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; toolUseId: string; isError: boolean; text: string };
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock;

type LineBase = { uuid: string; timestamp: string; isSidechain: boolean; cwd: string | null };

export type UserLine = LineBase & {
  type: "user";
  isMeta: boolean;
  isCompactSummary: boolean;
  originKind: string | null;
  /** True for a prompt Claude Code absorbed mid-turn (queued_command attachment): it has no user line of its own. */
  queuedPrompt: boolean;
  permissionMode: string | null;
  denialKind: string | null;
  toolUseResult: unknown;
  blocks: ContentBlock[];
};

export type AssistantLine = LineBase & {
  type: "assistant";
  model: string | null;
  messageId: string | null;
  /** Token usage of the message; null when the line carries none. */
  usage: LineUsage | null;
  blocks: ContentBlock[];
};

/** The system line Claude Code writes where a compaction (a summary) replaced the conversation before it. */
export const COMPACT_SUBTYPE = "compact_boundary";

export type SystemLine = LineBase & {
  type: "system";
  subtype: string;
  content: string | null;
  errorMessage: string | null;
  /** Context size right after a compaction (`compactMetadata.postTokens` of a compact boundary); null otherwise. */
  compactPostTokens: number | null;
};

export type TitleLine = { type: "title"; source: "ai" | "custom"; title: string };
export type PermissionModeLine = { type: "permission-mode"; permissionMode: string };

export type TranscriptLine = UserLine | AssistantLine | SystemLine | TitleLine | PermissionModeLine;
export type ConversationLine = UserLine | AssistantLine | SystemLine;

export type ParseStats = { parsed: number; blank: number; invalid: number; skipped: number };

export function createParseStats(): ParseStats {
  return { parsed: 0, blank: 0, invalid: 0, skipped: 0 };
}

export function isConversationLine(line: TranscriptLine): line is ConversationLine {
  return line.type === "user" || line.type === "assistant" || line.type === "system";
}
