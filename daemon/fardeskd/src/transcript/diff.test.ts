import { describe, expect, it } from "vitest";
import { CWD, at } from "../../test/support/transcriptLines.js";
import { diffSections } from "./diff.js";
import type { ToolCall } from "./toolCalls.js";

function edit(structured: unknown): ToolCall {
  return {
    id: "t1",
    name: "Edit",
    input: { file_path: `${CWD}/a.ts` },
    timestamp: at(0),
    seq: 1,
    result: { isError: false, denied: false, text: "ok", structured, timestamp: at(1) },
  };
}

describe("diffSections", () => {
  it("has no section for a call without a result or without diff content", () => {
    const pending: ToolCall = { ...edit(undefined), result: null };
    expect(diffSections([pending], CWD, 10)).toEqual({ sections: [], truncated: false });
    expect(diffSections([edit({ filePath: `${CWD}/a.ts`, structuredPatch: [] })], CWD, 10)).toEqual({ sections: [], truncated: false });
  });

  it("does not report truncation when the lines fit exactly", () => {
    const patch = { filePath: `${CWD}/a.ts`, structuredPatch: [{ oldStart: 1, newStart: 1, lines: ["+a", "+b"] }] };
    expect(diffSections([edit(patch)], CWD, 2).truncated).toBe(false);
  });
});
