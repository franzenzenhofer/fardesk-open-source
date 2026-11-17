import { describe, expect, it } from "vitest";
import { at } from "../../test/support/transcriptLines.js";
import { detailKind, diffOf, field, outputOfCall, ownDurationMs, resultOutput } from "./toolCalls.js";
import type { ToolCall, ToolResult } from "./toolCalls.js";

function result(overrides: Partial<ToolResult>): ToolResult {
  return { isError: false, denied: false, text: "fallback", structured: undefined, timestamp: at(1), ...overrides };
}

function call(name: string, resultValue: ToolResult | null): ToolCall {
  return { id: "t1", name, input: {}, timestamp: at(0), seq: 1, result: resultValue };
}

describe("field", () => {
  it("returns strings and an empty string for anything else", () => {
    expect(field({ a: "x", b: 1 }, "a")).toBe("x");
    expect(field({ a: "x", b: 1 }, "b")).toBe("");
    expect(field({}, "c")).toBe("");
  });
});

describe("resultOutput", () => {
  it.each([
    ["stdout and stderr, trailing newlines removed", { stdout: "out\n", stderr: "err\n\n" }, "out\nerr"],
    ["stdout only", { stdout: "out" }, "out"],
    ["stderr only", { stderr: "err" }, "err"],
    ["both empty", { stdout: "", stderr: "" }, ""],
    ["no stdout or stderr keys", { taskId: "x" }, "fallback"],
    ["a string result", "User rejected tool use", "fallback"],
    ["no structured result", undefined, "fallback"],
  ])("%s", (_name, structured, expected) => {
    expect(resultOutput(result({ structured }))).toBe(expected);
  });

  it("is empty for a call without a result", () => {
    expect(outputOfCall(call("Bash", null))).toBe("");
    expect(outputOfCall(call("Bash", result({ structured: { stdout: "x" } })))).toBe("x");
  });
});

describe("ownDurationMs and diffOf", () => {
  it("reads durationMs only when it is a number", () => {
    expect(ownDurationMs(result({ structured: { durationMs: 12 } }))).toBe(12);
    expect(ownDurationMs(result({ structured: { durationMs: "12" } }))).toBeNull();
    expect(ownDurationMs(result({ structured: "text" }))).toBeNull();
  });

  it("reads a diff result only when it has a file path and a patch array", () => {
    const patch = { filePath: "/a", structuredPatch: [] };
    expect(diffOf(call("Edit", result({ structured: patch })))).toMatchObject(patch);
    expect(diffOf(call("Edit", result({ structured: { filePath: "/a" } })))).toBeNull();
    expect(diffOf(call("Edit", null))).toBeNull();
  });
});

describe("detailKind", () => {
  const patch = { filePath: "/a", structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["+x"] }] };

  it.each([
    ["a pending call", call("Bash", null), null],
    ["a denied call", call("Bash", result({ denied: true })), null],
    ["a successful edit with a patch", call("Edit", result({ structured: patch })), "diff"],
    ["a created file", call("Write", result({ structured: { filePath: "/a", structuredPatch: [], content: "x" } })), "diff"],
    ["a successful edit without diff content", call("Edit", result({ structured: { filePath: "/a", structuredPatch: [] } })), null],
    ["a successful edit with an unreadable result", call("Edit", result({ structured: "ok" })), null],
    ["a failed edit with text", call("Edit", result({ isError: true })), "output"],
    ["a bash call with output", call("Bash", result({ structured: { stdout: "x" } })), "output"],
    ["a bash call without output", call("Bash", result({ text: "  ", structured: { stdout: "", stderr: "" } })), null],
  ])("%s", (_name, toolCall, expected) => {
    expect(detailKind(toolCall)).toBe(expected);
  });
});
