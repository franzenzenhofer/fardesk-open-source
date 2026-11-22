import { describe, expect, it } from "vitest";
import { at, parseObject, say, system, user } from "../../test/support/transcriptLines.js";
import { COMPACT_SUBTYPE } from "./lineTypes.js";
import { FIVE_MINUTES_MS, ONE_HOUR_MS, lastContextUsage, parseUsage } from "./usage.js";
import { summarise } from "./summary.js";

const MAX = 80;

function withUsage(second: number, usage: unknown, extra: Record<string, unknown> = {}): ReturnType<typeof parseObject> {
  return parseObject({
    type: "assistant",
    message: { role: "assistant", id: `m${second}`, model: "claude-test", content: [{ type: "text", text: "hi" }], usage },
    uuid: `u${second}`,
    timestamp: at(second),
    isSidechain: false,
    cwd: "/work/project",
    ...extra,
  });
}

const ONE_HOUR_USAGE = {
  input_tokens: 2,
  cache_read_input_tokens: 425_703,
  cache_creation_input_tokens: 618,
  cache_creation: { ephemeral_1h_input_tokens: 618, ephemeral_5m_input_tokens: 0 },
};

describe("parseUsage", () => {
  it("sums input, cache read and cache creation and picks the 1 h bucket when it was written", () => {
    expect(parseUsage(ONE_HOUR_USAGE)).toEqual({ contextTokens: 426_323, cacheTtlMs: ONE_HOUR_MS });
  });

  it("uses 5 minutes for the 5 minute bucket and when there is no breakdown", () => {
    const fiveMinutes = { input_tokens: 5, cache_creation_input_tokens: 100, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 100 } };
    expect(parseUsage(fiveMinutes)).toEqual({ contextTokens: 105, cacheTtlMs: FIVE_MINUTES_MS });
    expect(parseUsage({ cache_read_input_tokens: 7 })).toEqual({ contextTokens: 7, cacheTtlMs: FIVE_MINUTES_MS });
  });

  it("is null for missing, malformed or token-less usage", () => {
    expect(parseUsage(undefined)).toBeNull();
    expect(parseUsage("lots")).toBeNull();
    expect(parseUsage({ input_tokens: "many" })).toBeNull();
    expect(parseUsage({ service_tier: "standard" })).toBeNull();
  });
});

describe("usage on transcript lines", () => {
  it("keeps the line valid when its usage is garbage", () => {
    expect(withUsage(1, 42)).toMatchObject({ type: "assistant", usage: null });
    expect(withUsage(1, ONE_HOUR_USAGE)).toMatchObject({ type: "assistant", usage: { contextTokens: 426_323 } });
  });

  it("takes the LAST main-chain assistant line with usage: 1 h bucket", () => {
    const lines = [user(1, "go"), withUsage(2, { input_tokens: 1 }), withUsage(5, ONE_HOUR_USAGE), say(6, "no usage here")];
    expect(lastContextUsage(lines)).toEqual({ contextTokens: 426_323, cacheExpiresAt: new Date(Date.parse(at(5)) + ONE_HOUR_MS).toISOString(), lastTurnAt: new Date(Date.parse(at(5))).toISOString() });
    expect(summarise(lines, MAX)).toMatchObject({ contextTokens: 426_323, cacheExpiresAt: "2026-01-01T11:00:05.000Z" });
  });

  it("takes the 5 minute bucket for a line without a 1 h write", () => {
    const lines = [withUsage(3, { input_tokens: 10, cache_read_input_tokens: 90, cache_creation_input_tokens: 5, cache_creation: { ephemeral_5m_input_tokens: 5 } })];
    expect(summarise(lines, MAX)).toMatchObject({ contextTokens: 105, cacheExpiresAt: "2026-01-01T10:05:03.000Z" });
  });

  it("ignores sidechain (subagent) lines", () => {
    const lines = [withUsage(2, { input_tokens: 100 }), withUsage(9, ONE_HOUR_USAGE, { isSidechain: true })];
    expect(summarise(lines, MAX)).toMatchObject({ contextTokens: 100, cacheExpiresAt: "2026-01-01T10:05:02.000Z" });
  });

  it("is null without any usage", () => {
    expect(lastContextUsage([user(1, "go"), say(2, "plain")])).toBeNull();
    expect(summarise([user(1, "go"), say(2, "plain")], MAX)).toMatchObject({ contextTokens: null, cacheExpiresAt: null });
  });
});

describe("usage after a compaction", () => {
  const boundary = (second: number, metadata: unknown): ReturnType<typeof system> =>
    system(second, COMPACT_SUBTYPE, { content: "Conversation compacted", compactMetadata: metadata });

  it("a compaction after the last answer gives the size after the summary and no cache expiry (never cold)", () => {
    const lines = [withUsage(2, ONE_HOUR_USAGE), boundary(9, { trigger: "manual", preTokens: 426_323, postTokens: 27_005 })];
    expect(lastContextUsage(lines)).toEqual({ contextTokens: 27_005, cacheExpiresAt: null, lastTurnAt: null });
    expect(summarise(lines, MAX)).toMatchObject({ contextTokens: 27_005, cacheExpiresAt: null });
  });

  it("an answer after the compaction counts again", () => {
    const lines = [boundary(2, { postTokens: 27_005 }), withUsage(5, { input_tokens: 30_000 })];
    expect(lastContextUsage(lines)).toEqual({ contextTokens: 30_000, cacheExpiresAt: new Date(Date.parse(at(5)) + FIVE_MINUTES_MS).toISOString(), lastTurnAt: new Date(Date.parse(at(5))).toISOString() });
  });

  it("a boundary without readable metadata still clears the cache expiry", () => {
    expect(lastContextUsage([withUsage(1, ONE_HOUR_USAGE), boundary(3, "garbage")])).toEqual({ contextTokens: null, cacheExpiresAt: null, lastTurnAt: null });
  });
});
