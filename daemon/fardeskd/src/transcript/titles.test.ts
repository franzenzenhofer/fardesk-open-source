import { describe, expect, it } from "vitest";
import { COMMAND_TITLE_MAX, subjectOf, toolTitle } from "./titles.js";
import type { TitleContext } from "./titles.js";

const OK: TitleContext = { status: "ok", denied: false, output: "" };
const RUNNING: TitleContext = { status: "running", denied: false, output: "" };
const FAILED: TitleContext = { status: "error", denied: false, output: "" };
const DENIED: TitleContext = { status: "error", denied: true, output: "" };

type Case = [string, Record<string, unknown>, TitleContext, string];

const CASES: Case[] = [
  ["Edit", { file_path: "/work/p/Sources/PaintEngine.swift" }, OK, "Edited PaintEngine.swift"],
  ["MultiEdit", { file_path: "/work/p/a.ts" }, OK, "Edited a.ts"],
  ["Write", { file_path: "/work/p/notes.md" }, OK, "Wrote notes.md"],
  ["Read", { file_path: "/work/p/src/index.ts" }, OK, "Read index.ts"],
  ["Grep", { pattern: "createServer" }, OK, "Searched for createServer"],
  ["Glob", { pattern: "src/**/*.ts" }, OK, "Listed src/**/*.ts"],
  ["Bash", { command: "swift test" }, OK, "Ran swift test"],
  ["Bash", { command: "swift test" }, RUNNING, "Running swift test..."],
  ["Bash", { command: "swift test" }, FAILED, "Failed swift test"],
  ["Bash", { command: "npm test\necho done" }, OK, "Ran npm test"],
  ["Bash", { command: "git `status` — now" }, OK, "Ran git 'status' - now"],
  ["Bash", { command: "x".repeat(100) }, OK, `Ran ${"x".repeat(COMMAND_TITLE_MAX - 3)}...`],
  ["Bash", { command: "npm test" }, { ...OK, output: "      Tests  31 passed (31)" }, "Ran npm test - 31 passed"],
  ["Bash", { command: "npm test" }, { ...OK, output: "      Tests  2 failed | 29 passed (31)" }, "Ran npm test - 2 failed"],
  ["Bash", { command: "swift test" }, { ...OK, output: "Executed 31 tests, with 0 failures (0 unexpected)" }, "Ran swift test - 31 passed"],
  ["Bash", { command: "swift test" }, { ...FAILED, output: "Executed 31 tests, with 1 failures" }, "Failed swift test"],
  ["Agent", { description: "Explore the daemon" }, OK, "Agent: Explore the daemon"],
  ["WebFetch", { url: "https://docs.example.com/a/b?q=1" }, OK, "Fetched docs.example.com"],
  ["WebFetch", { url: "not a url" }, OK, "Fetched not a url"],
  ["WebSearch", { query: "swift concurrency" }, OK, "Searched the web for swift concurrency"],
  ["mcp__claude-in-chrome__navigate", {}, OK, "navigate (claude-in-chrome)"],
  ["mcp__plugin_x__tool__with__parts", {}, OK, "tool__with__parts (plugin_x)"],
  ["ToolSearch", { query: "select:Read" }, OK, "Used ToolSearch"],
  ["TaskCreate", {}, OK, "Used TaskCreate"],
  ["Edit", {}, OK, "Edited "],
  ["Bash", { command: "echo hi" }, DENIED, "Denied: echo hi"],
  ["Edit", { file_path: "/work/p/a.ts" }, DENIED, "Denied: a.ts"],
  ["Grep", { pattern: "foo" }, DENIED, "Denied: foo"],
  ["mcp__srv__do", {}, DENIED, "Denied: do (srv)"],
  ["ExitPlanMode", {}, DENIED, "Denied: ExitPlanMode"],
];

describe("toolTitle", () => {
  it.each(CASES)("%s %j %j -> %j", (name, input, context, expected) => {
    expect(toolTitle({ name, input }, context)).toBe(expected);
  });

  it("never contains backticks or em/en dashes", () => {
    for (const [name, input, context] of CASES) {
      const title = toolTitle({ name, input }, context);
      expect(title).not.toMatch(/[`–—]/);
    }
  });
});

describe("subjectOf", () => {
  it("caps long patterns", () => {
    expect(subjectOf({ name: "Grep", input: { pattern: "p".repeat(200) } })).toHaveLength(60);
  });
});
