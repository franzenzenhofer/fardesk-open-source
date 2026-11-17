import { describe, expect, it } from "vitest";
import { at, parseObject, readFixture } from "../../test/support/transcriptLines.js";
import { createParseStats, parseLine } from "./lineSchema.js";

const BASE = { uuid: "u1", timestamp: at(1), cwd: "/w" };

describe("parseLine", () => {
  it("parses a user line with the fields the feed uses", () => {
    const line = parseLine(
      JSON.stringify({
        ...BASE,
        type: "user",
        isSidechain: true,
        isMeta: true,
        isCompactSummary: true,
        permissionMode: "plan",
        origin: { kind: "peer" },
        toolDenialKind: "user-rejected",
        toolUseResult: { stdout: "x" },
        message: { role: "user", content: "hi" },
      }),
    );
    expect(line).toEqual({
      type: "user",
      uuid: "u1",
      timestamp: at(1),
      isSidechain: true,
      cwd: "/w",
      isMeta: true,
      isCompactSummary: true,
      originKind: "peer",
      queuedPrompt: false,
      permissionMode: "plan",
      denialKind: "user-rejected",
      toolUseResult: { stdout: "x" },
      blocks: [{ type: "text", text: "hi" }],
    });
  });

  it("defaults the optional user fields", () => {
    const line = parseObject({ type: "user", uuid: "u1", timestamp: at(1), message: { content: [] } });
    expect(line).toMatchObject({
      isSidechain: false,
      isMeta: false,
      isCompactSummary: false,
      cwd: null,
      originKind: null,
      queuedPrompt: false,
      permissionMode: null,
      denialKind: null,
      blocks: [],
    });
  });

  it("keeps text, image, tool_use and tool_result blocks and drops thinking and unknown ones", () => {
    const line = parseObject({
      ...BASE,
      type: "assistant",
      message: {
        model: "claude-x",
        id: "msg_1",
        content: [
          { type: "thinking", thinking: "secret", signature: "s" },
          { type: "redacted_thinking", data: "x" },
          { type: "text", text: "hello" },
          { type: "image", source: {} },
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "", name: "Bash", input: {} },
          { type: "tool_reference", name: "Y" },
          "not an object",
        ],
      },
    });
    expect(line).toMatchObject({
      type: "assistant",
      model: "claude-x",
      messageId: "msg_1",
      blocks: [
        { type: "text", text: "hello" },
        { type: "image" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ],
    });
  });

  it("flattens tool_result content given as a string, text parts or something else", () => {
    const content = [
      { type: "tool_result", tool_use_id: "a", content: "plain", is_error: true },
      { type: "tool_result", tool_use_id: "b", content: [{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "two" }] },
      { type: "tool_result", tool_use_id: "c", content: 42 },
      { type: "tool_result", tool_use_id: "d" },
    ];
    const line = parseObject({ ...BASE, type: "user", message: { content } });
    expect(line).toMatchObject({
      blocks: [
        { toolUseId: "a", isError: true, text: "plain" },
        { toolUseId: "b", isError: false, text: "one\ntwo" },
        { toolUseId: "c", isError: false, text: "" },
        { toolUseId: "d", isError: false, text: "" },
      ],
    });
  });

  it("defaults the optional assistant fields", () => {
    const line = parseObject({ type: "assistant", uuid: "a", timestamp: at(1), message: { content: "plain text" } });
    expect(line).toMatchObject({ model: null, messageId: null, cwd: null, blocks: [{ type: "text", text: "plain text" }] });
  });

  it("parses system lines with and without an error object", () => {
    const withError = parseObject({ ...BASE, type: "system", subtype: "api_error", error: { message: "boom", extra: 1 } });
    expect(withError).toMatchObject({ subtype: "api_error", errorMessage: "boom", content: null });
    const withContent = parseObject({ ...BASE, type: "system", subtype: "compact_boundary", content: "x", error: "str" });
    expect(withContent).toMatchObject({ errorMessage: null, content: "x" });
    const bare = parseObject({ type: "system", subtype: "turn_duration", uuid: "s", timestamp: at(1) });
    expect(bare).toMatchObject({ cwd: null, isSidechain: false });
  });

  it("parses title and permission-mode lines", () => {
    expect(parseObject({ type: "ai-title", aiTitle: "Fix build" })).toEqual({ type: "title", source: "ai", title: "Fix build" });
    expect(parseObject({ type: "agent-name", agentName: "mine" })).toEqual({ type: "title", source: "custom", title: "mine" });
    expect(parseObject({ type: "custom-title", customTitle: "named" })).toEqual({ type: "title", source: "custom", title: "named" });
    expect(parseObject({ type: "permission-mode", permissionMode: "plan" })).toEqual({ type: "permission-mode", permissionMode: "plan" });
  });

  describe("returns null and counts", () => {
    it("blank lines", () => {
      const stats = createParseStats();
      expect(parseLine("", stats)).toBeNull();
      expect(parseLine("   \t", stats)).toBeNull();
      expect(stats).toEqual({ parsed: 0, blank: 2, invalid: 0, skipped: 0 });
    });

    it.each([
      ["a half-written line", '{"type":"user","uuid":"u'],
      ["a JSON scalar", "42"],
      ["an object without a type", '{"uuid":"u"}'],
      ["a user line without a timestamp", '{"type":"user","uuid":"u","message":{"content":"x"}}'],
      ["a user line with a bad timestamp", '{"type":"user","uuid":"u","timestamp":"yesterday","message":{"content":"x"}}'],
      ["a user line without a message", `{"type":"user","uuid":"u","timestamp":"${at(1)}"}`],
      ["a title line with an empty title", '{"type":"ai-title","aiTitle":""}'],
    ])("invalid: %s", (_name, raw) => {
      const stats = createParseStats();
      expect(parseLine(raw, stats)).toBeNull();
      expect(stats).toEqual({ parsed: 0, blank: 0, invalid: 1, skipped: 0 });
    });

    it.each(["api-request", "api-request-blob", "file-history-snapshot", "attachment", "mode", "atis-latch", "queue-operation", "last-prompt", "cost-state", "constructor"])(
      "skipped line type %s",
      (type) => {
        const stats = createParseStats();
        expect(parseLine(JSON.stringify({ type, uuid: "x" }), stats)).toBeNull();
        expect(stats).toEqual({ parsed: 0, blank: 0, invalid: 0, skipped: 1 });
      },
    );
  });

  it("counts parsed lines and works without a stats object", () => {
    const stats = createParseStats();
    parseLine(JSON.stringify({ type: "ai-title", aiTitle: "t" }), stats);
    expect(stats.parsed).toBe(1);
    expect(parseLine(JSON.stringify({ type: "ai-title", aiTitle: "t" }))).not.toBeNull();
  });

  it("classifies every line of every real fixture without invalid lines", () => {
    const names = ["01-simple-session", "05-edit-write-read-test-run", "12-web-mcp-devtools", "28-rare-tools-bundle", "30-peer-message-reply"];
    for (const name of names) {
      const stats = createParseStats();
      for (const raw of readFixture(name)) parseLine(raw, stats);
      expect(stats.invalid, name).toBe(0);
      expect(stats.parsed, name).toBeGreaterThan(0);
    }
  });
});
