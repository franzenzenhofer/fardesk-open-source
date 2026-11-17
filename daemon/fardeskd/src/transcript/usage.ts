// Token usage of an assistant line and the prompt-cache lifetime derived from it.
import { z } from "zod";
import type { AssistantLine, TranscriptLine } from "./lineTypes.js";

export const FIVE_MINUTES_MS = 5 * 60_000;
export const ONE_HOUR_MS = 60 * 60_000;

/** Claude Code writes a single `message.usage` per assistant message; every field is optional in real transcripts. */
export const usageSchema = z.looseObject({
  input_tokens: z.number().optional(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cache_creation: z
    .looseObject({
      ephemeral_1h_input_tokens: z.number().optional(),
      ephemeral_5m_input_tokens: z.number().optional(),
    })
    .optional(),
});

export type LineUsage = {
  /** input + cache read + cache creation tokens: what the next turn has to read again. */
  contextTokens: number;
  /** How long the cache written by this message lives: 1 h when it used the 1 h bucket, else 5 min. */
  cacheTtlMs: number;
};

/** null for a missing or malformed usage object: the line itself stays valid. */
export function parseUsage(value: unknown): LineUsage | null {
  const parsed = usageSchema.safeParse(value);
  if (!parsed.success) return null;
  const raw = parsed.data;
  const counts = [raw.input_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens];
  if (counts.every((count) => count === undefined)) return null;
  const contextTokens = (raw.input_tokens ?? 0) + (raw.cache_read_input_tokens ?? 0) + (raw.cache_creation_input_tokens ?? 0);
  const usedOneHour = (raw.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0;
  return { contextTokens, cacheTtlMs: usedOneHour ? ONE_HOUR_MS : FIVE_MINUTES_MS };
}

export type ContextUsage = { contextTokens: number; cacheExpiresAt: string };

const hasUsage = (line: TranscriptLine): line is AssistantLine & { usage: LineUsage } =>
  line.type === "assistant" && !line.isSidechain && line.usage !== null;

/** The context size and cache expiry of the last main-chain assistant line that carries usage; null without one. */
export function lastContextUsage(lines: readonly TranscriptLine[]): ContextUsage | null {
  const last = lines.findLast(hasUsage);
  if (last === undefined) return null;
  const expiresAtMs = Date.parse(last.timestamp) + last.usage.cacheTtlMs;
  return { contextTokens: last.usage.contextTokens, cacheExpiresAt: new Date(expiresAtMs).toISOString() };
}
