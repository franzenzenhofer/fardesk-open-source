import { z } from "zod";

// Claude Code owns this format: lenient, unknown keys are kept in `raw`.
const hookPayloadSchema = z.looseObject({
  session_id: z.string().min(1),
  hook_event_name: z.string().min(1),
  transcript_path: z.string().optional(),
  cwd: z.string().optional(),
  permission_mode: z.string().optional(),
  tool_name: z.string().optional(),
  tool_input: z.record(z.string(), z.unknown()).optional(),
  permission_suggestions: z.array(z.unknown()).optional(),
  last_assistant_message: z.string().optional(),
  reason: z.string().optional(),
  source: z.string().optional(),
  model: z.string().optional(),
});

export type HookEvent = {
  sessionId: string;
  hookEventName: string;
  transcriptPath?: string;
  cwd?: string;
  permissionMode?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  permissionSuggestions?: unknown[];
  lastAssistantMessage?: string;
  reason?: string;
  source?: string;
  model?: string;
  raw: Record<string, unknown>;
};

const OPTIONAL_FIELDS = [
  ["transcript_path", "transcriptPath"],
  ["cwd", "cwd"],
  ["permission_mode", "permissionMode"],
  ["tool_name", "toolName"],
  ["tool_input", "toolInput"],
  ["permission_suggestions", "permissionSuggestions"],
  ["last_assistant_message", "lastAssistantMessage"],
  ["reason", "reason"],
  ["source", "source"],
  ["model", "model"],
] as const;

export type HookParseResult = { ok: true; event: HookEvent } | { ok: false; error: string };

export function parseHookPayload(value: unknown): HookParseResult {
  const parsed = hookPayloadSchema.safeParse(value);
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  const data = parsed.data;
  const event: Record<string, unknown> = {
    sessionId: data.session_id,
    hookEventName: data.hook_event_name,
    raw: data,
  };
  for (const [snake, camel] of OPTIONAL_FIELDS) {
    const field = data[snake];
    if (field !== undefined) event[camel] = field;
  }
  return { ok: true, event: event as HookEvent };
}
