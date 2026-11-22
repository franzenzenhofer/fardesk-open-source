// Lenient zod schemas for the transcript fields the feed uses. Claude Code owns the format, so
// every object is loose and unknown line types or blocks are skipped (and counted), never fatal.
import { z } from "zod";
import { createParseStats } from "./lineTypes.js";
import { parseUsage } from "./usage.js";
import type { ContentBlock, ParseStats, TranscriptLine } from "./lineTypes.js";

export { createParseStats };

const toolResultPartsSchema = z.array(z.looseObject({ type: z.string(), text: z.string().optional() }));

const blockSchema = z.discriminatedUnion("type", [
  z.looseObject({ type: z.literal("text"), text: z.string() }),
  z.looseObject({ type: z.literal("image") }),
  z.looseObject({
    type: z.literal("tool_use"),
    id: z.string().min(1),
    name: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
  }),
  z.looseObject({
    type: z.literal("tool_result"),
    tool_use_id: z.string().min(1),
    is_error: z.boolean().optional(),
    content: z.unknown().optional(),
  }),
]);

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  const parts = toolResultPartsSchema.safeParse(content);
  if (!parts.success) return "";
  return parts.data.flatMap((part) => (part.text === undefined ? [] : [part.text])).join("\n");
}

function toBlock(block: z.infer<typeof blockSchema>): ContentBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "image":
      return { type: "image" };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        toolUseId: block.tool_use_id,
        isError: block.is_error === true,
        text: resultText(block.content),
      };
  }
}

// Thinking, redacted thinking and any block type the feed does not know are dropped right here.
function toBlocks(content: string | unknown[]): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return content.flatMap((item) => {
    const parsed = blockSchema.safeParse(item);
    return parsed.success ? [toBlock(parsed.data)] : [];
  });
}

const contentSchema = z.union([z.string(), z.array(z.unknown())]);
const lineBase = {
  uuid: z.string().min(1),
  timestamp: z.iso.datetime(),
  isSidechain: z.boolean().default(false),
  cwd: z.string().optional(),
};

const userSchema = z
  .looseObject({
    ...lineBase,
    type: z.literal("user"),
    message: z.looseObject({ content: contentSchema }),
    isMeta: z.boolean().default(false),
    isCompactSummary: z.boolean().default(false),
    origin: z.looseObject({ kind: z.string().optional() }).optional(),
    permissionMode: z.string().optional(),
    toolDenialKind: z.string().optional(),
    toolUseResult: z.unknown().optional(),
  })
  .transform(
    (raw): TranscriptLine => ({
      type: "user",
      uuid: raw.uuid,
      timestamp: raw.timestamp,
      isSidechain: raw.isSidechain,
      cwd: raw.cwd ?? null,
      isMeta: raw.isMeta,
      isCompactSummary: raw.isCompactSummary,
      originKind: raw.origin?.kind ?? null,
      queuedPrompt: false,
      permissionMode: raw.permissionMode ?? null,
      denialKind: raw.toolDenialKind ?? null,
      toolUseResult: raw.toolUseResult,
      blocks: toBlocks(raw.message.content),
    }),
  );

// A message typed into a working session is absorbed mid-turn and the transcript records it only as
// this attachment (no user line). Other command modes (task notifications, scheduled tasks) are not prompts.
const QUEUED_PROMPT_MODE = "prompt";
const queuedPromptSchema = z
  .looseObject({
    ...lineBase,
    type: z.literal("attachment"),
    attachment: z.looseObject({
      type: z.literal("queued_command"),
      prompt: z.union([z.string().min(1), z.array(z.unknown()).min(1)]),
      commandMode: z.literal(QUEUED_PROMPT_MODE),
      origin: z.looseObject({ kind: z.string().optional() }).optional(),
    }),
  })
  .transform(
    (raw): TranscriptLine => ({
      type: "user",
      uuid: raw.uuid,
      timestamp: raw.timestamp,
      isSidechain: raw.isSidechain,
      cwd: raw.cwd ?? null,
      isMeta: false,
      isCompactSummary: false,
      originKind: raw.attachment.origin?.kind ?? null,
      queuedPrompt: true,
      permissionMode: null,
      denialKind: null,
      toolUseResult: undefined,
      blocks: toBlocks(raw.attachment.prompt),
    }),
  );

const assistantSchema = z
  .looseObject({
    ...lineBase,
    type: z.literal("assistant"),
    message: z.looseObject({
      content: contentSchema,
      model: z.string().optional(),
      id: z.string().optional(),
      usage: z.unknown().optional(),
    }),
  })
  .transform(
    (raw): TranscriptLine => ({
      type: "assistant",
      uuid: raw.uuid,
      timestamp: raw.timestamp,
      isSidechain: raw.isSidechain,
      cwd: raw.cwd ?? null,
      model: raw.message.model ?? null,
      messageId: raw.message.id ?? null,
      usage: parseUsage(raw.message.usage),
      blocks: toBlocks(raw.message.content),
    }),
  );

const errorSchema = z.looseObject({ message: z.string().min(1) });
const compactMetadataSchema = z.looseObject({ postTokens: z.number().int().nonnegative() });

const systemSchema = z
  .looseObject({
    ...lineBase,
    type: z.literal("system"),
    subtype: z.string().min(1),
    content: z.string().optional(),
    error: z.unknown().optional(),
    compactMetadata: z.unknown().optional(),
  })
  .transform(
    (raw): TranscriptLine => ({
      type: "system",
      uuid: raw.uuid,
      timestamp: raw.timestamp,
      isSidechain: raw.isSidechain,
      cwd: raw.cwd ?? null,
      subtype: raw.subtype,
      content: raw.content ?? null,
      errorMessage: errorSchema.safeParse(raw.error).data?.message ?? null,
      compactPostTokens: compactMetadataSchema.safeParse(raw.compactMetadata).data?.postTokens ?? null,
    }),
  );

const aiTitleSchema = z
  .looseObject({ type: z.literal("ai-title"), aiTitle: z.string().min(1) })
  .transform((raw): TranscriptLine => ({ type: "title", source: "ai", title: raw.aiTitle }));
const agentNameSchema = z
  .looseObject({ type: z.literal("agent-name"), agentName: z.string().min(1) })
  .transform((raw): TranscriptLine => ({ type: "title", source: "custom", title: raw.agentName }));
const customTitleSchema = z
  .looseObject({ type: z.literal("custom-title"), customTitle: z.string().min(1) })
  .transform((raw): TranscriptLine => ({ type: "title", source: "custom", title: raw.customTitle }));
const permissionModeSchema = z
  .looseObject({ type: z.literal("permission-mode"), permissionMode: z.string().min(1) })
  .transform((raw): TranscriptLine => ({ type: "permission-mode", permissionMode: raw.permissionMode }));

const KEPT_LINE_SCHEMAS = {
  user: userSchema,
  attachment: queuedPromptSchema,
  assistant: assistantSchema,
  system: systemSchema,
  "ai-title": aiTitleSchema,
  "agent-name": agentNameSchema,
  "custom-title": customTitleSchema,
  "permission-mode": permissionModeSchema,
} as const;

const typeProbeSchema = z.looseObject({ type: z.string() });

function isKeptType(type: string): type is keyof typeof KEPT_LINE_SCHEMAS {
  return Object.hasOwn(KEPT_LINE_SCHEMAS, type);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// null = blank line, invalid JSON (a file can be mid-write), or a line type the feed does not need.
export function parseLine(raw: string, stats: ParseStats = createParseStats()): TranscriptLine | null {
  if (raw.trim() === "") {
    stats.blank += 1;
    return null;
  }
  const probe = typeProbeSchema.safeParse(parseJson(raw));
  if (!probe.success) {
    stats.invalid += 1;
    return null;
  }
  const type = probe.data.type;
  if (!isKeptType(type)) {
    stats.skipped += 1;
    return null;
  }
  const line = KEPT_LINE_SCHEMAS[type].safeParse(probe.data);
  if (!line.success) {
    // Most attachments are not queued prompts: that is a skipped line type, not a malformed line.
    if (type === "attachment") stats.skipped += 1;
    else stats.invalid += 1;
    return null;
  }
  stats.parsed += 1;
  return line.data;
}
