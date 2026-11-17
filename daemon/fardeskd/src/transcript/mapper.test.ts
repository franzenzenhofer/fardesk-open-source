import { describe, expect, it } from "vitest";
import { CWD, assistant, at, say, system, toolResult, toolUse, user } from "../../test/support/transcriptLines.js";
import type { TranscriptLine } from "./lineTypes.js";
import { mapActivities } from "./mapper.js";

const OPTIONS = { cwd: CWD };

function editResult(path: string): Record<string, unknown> {
  const hunk = { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ["-old", "+new"] };
  return { filePath: path, structuredPatch: [hunk] };
}

function titles(lines: TranscriptLine[]): string[] {
  return mapActivities(lines, OPTIONS).map((row) => ("title" in row ? row.title : row.kind));
}

describe("plain rows", () => {
  it("maps prompts, replies and drops thinking and sidechains, with the line uuid as id", () => {
    const rows = mapActivities(
      [
        user(1, "fix it"),
        assistant(2, [{ type: "thinking", thinking: "hmm" }]),
        say(3, "  On it.  "),
        assistant(4, [{ type: "text", text: "first" }, { type: "text", text: "  " }, { type: "text", text: "second" }]),
        user(5, "from a subagent", { isSidechain: true }),
        assistant(6, [{ type: "text", text: "sidechain reply" }], { isSidechain: true }),
      ],
      OPTIONS,
    );
    expect(rows.map((row) => [row.kind, row.id, "text" in row ? row.text : ""])).toEqual([
      ["user", "line-1", "fix it"],
      ["assistant", "line-3", "On it."],
      ["assistant", "line-4", "first"],
      ["assistant", "line-4#2", "second"],
    ]);
  });

  it("maps interruption, compaction and api errors, and ignores other system lines", () => {
    const rows = mapActivities(
      [
        user(1, [{ type: "text", text: "[Request interrupted by user]" }]),
        system(2, "compact_boundary", { content: "Conversation compacted" }),
        system(3, "api_error", { error: { message: `first line\nsecond line ${"x".repeat(300)}` } }),
        system(4, "api_error", { error: { message: "e".repeat(300) } }),
        system(5, "api_error"),
        system(6, "turn_duration"),
        system(7, "stop_hook_summary"),
      ],
      OPTIONS,
    );
    expect(rows.map((row) => ("text" in row ? row.text : ""))).toEqual([
      "Interrupted",
      "Conversation compacted",
      "first line",
      `${"e".repeat(197)}...`,
      "API error",
    ]);
    expect(rows.every((row) => row.kind === "system")).toBe(true);
  });
});

describe("tool rows", () => {
  it("is ok with the result's own duration when present", () => {
    const rows = mapActivities(
      [
        toolUse(1, "t1", "WebFetch", { url: "https://example.com/x" }),
        toolResult(5, "t1", "page", { line: { toolUseResult: { durationMs: 1234.4, bytes: 10 } } }),
      ],
      OPTIONS,
    );
    expect(rows).toEqual([
      { kind: "tool", id: "t1", ts: rows[0]?.ts, tool: "WebFetch", title: "Fetched example.com", status: "ok", hasDetail: true, durationMs: 1234 },
    ]);
  });

  it("falls back to the timestamp difference, never negative", () => {
    const rows = mapActivities(
      [toolUse(10, "a", "Bash", { command: "ls" }), toolResult(12, "a", "x"), toolUse(20, "b", "Bash", { command: "ls" }), toolResult(19, "b", "x")],
      OPTIONS,
    );
    expect(rows.map((row) => (row.kind === "tool" ? row.durationMs : -1))).toEqual([2000, 0]);
  });

  it("is error for is_error results and keeps a detail when there is output", () => {
    const rows = mapActivities(
      [toolUse(1, "t1", "Bash", { command: "make" }), toolResult(2, "t1", "boom", { isError: true })],
      OPTIONS,
    );
    expect(rows).toMatchObject([{ title: "Failed make", status: "error", hasDetail: true }]);
  });

  it("titles a user denial and gives it no detail", () => {
    const rows = mapActivities(
      [
        toolUse(1, "t1", "Bash", { command: "rm -rf build" }),
        toolResult(2, "t1", "The user doesn't want to proceed", { isError: true, line: { toolDenialKind: "user-rejected", toolUseResult: "User rejected tool use" } }),
      ],
      OPTIONS,
    );
    expect(rows).toMatchObject([{ title: "Denied: rm -rf build", status: "error", hasDetail: false }]);
  });

  it("is running without a result when nothing came after it", () => {
    const rows = mapActivities([say(1, "starting"), toolUse(2, "t1", "Bash", { command: "swift test" })], OPTIONS);
    expect(rows[1]).toMatchObject({ title: "Running swift test...", status: "running", hasDetail: false, durationMs: null });
  });

  it("is error when the conversation went on without a result (interrupted)", () => {
    const afterText = mapActivities([toolUse(1, "t1", "Bash", { command: "sleep 9" }), say(2, "moving on")], OPTIONS);
    expect(afterText[0]).toMatchObject({ title: "Failed sleep 9", status: "error" });
    const afterPrompt = mapActivities([toolUse(1, "t1", "Bash", { command: "sleep 9" }), user(2, "stop")], OPTIONS);
    expect(afterPrompt[0]).toMatchObject({ status: "error" });
  });

  it("keeps parallel calls running together, and errors the one whose sibling finished first", () => {
    const both = mapActivities([assistant(1, [{ type: "tool_use", id: "a", name: "Bash", input: { command: "one" } }]), toolUse(2, "b", "Bash", { command: "two" })], OPTIONS);
    expect(both.map((row) => (row.kind === "tool" ? row.status : ""))).toEqual(["running", "running"]);
    const lost = mapActivities([toolUse(1, "a", "Bash", { command: "one" }), toolUse(2, "b", "Bash", { command: "two" }), toolResult(3, "b", "done")], OPTIONS);
    expect(lost.map((row) => (row.kind === "tool" ? row.status : ""))).toEqual(["error", "ok"]);
  });

  it("is still running when text comes before the call in the same message", () => {
    const rows = mapActivities([assistant(1, [{ type: "text", text: "run" }, { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }])], OPTIONS);
    expect(rows.map((row) => row.kind)).toEqual(["assistant", "tool"]);
    expect(rows[1]).toMatchObject({ status: "running" });
  });

  it("adds the test-runner summary to a Bash title", () => {
    const rows = mapActivities(
      [
        toolUse(1, "t1", "Bash", { command: "npm test" }),
        toolResult(2, "t1", "x", { line: { toolUseResult: { stdout: "      Tests  31 passed (31)", stderr: "" } } }),
      ],
      OPTIONS,
    );
    expect(rows).toMatchObject([{ title: "Ran npm test - 31 passed" }]);
  });

  it("ignores results of calls it never saw (a transcript window)", () => {
    expect(mapActivities([toolResult(1, "unknown", "x"), say(2, "hi")], OPTIONS)).toHaveLength(1);
  });
});

describe("questions", () => {
  const input = { questions: [{ question: "Which one?", header: "h", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }, { question: "Second?", options: [] }] };

  it("maps an answered question", () => {
    const rows = mapActivities([toolUse(1, "q1", "AskUserQuestion", input), toolResult(2, "q1", "answered")], OPTIONS);
    expect(rows).toEqual([{ kind: "question", id: "q1", ts: rows[0]?.ts, requestId: "q1", text: "Which one?", options: ["A", "B"], state: "answered" }]);
  });

  it("expires a denied or errored question", () => {
    const denied = mapActivities([toolUse(1, "q1", "AskUserQuestion", input), toolResult(2, "q1", "no", { isError: true, line: { toolDenialKind: "user-rejected" } })], OPTIONS);
    const errored = mapActivities([toolUse(1, "q1", "AskUserQuestion", input), toolResult(2, "q1", "no", { isError: true })], OPTIONS);
    expect(denied).toMatchObject([{ kind: "question", state: "expired" }]);
    expect(errored).toMatchObject([{ kind: "question", state: "expired" }]);
  });

  it("produces nothing for an unanswered question", () => {
    expect(mapActivities([toolUse(1, "q1", "AskUserQuestion", input)], OPTIONS)).toEqual([]);
  });

  it("defaults missing options to none and shows a malformed question as a tool row", () => {
    const noOptions = { questions: [{ question: "Free text?" }] };
    expect(mapActivities([toolUse(1, "q1", "AskUserQuestion", noOptions), toolResult(2, "q1", "x")], OPTIONS)).toMatchObject([{ kind: "question", options: [] }]);
    expect(mapActivities([toolUse(1, "q1", "AskUserQuestion", {}), toolResult(2, "q1", "x")], OPTIONS)).toMatchObject([{ kind: "tool", title: "Used AskUserQuestion" }]);
  });
});

describe("merging lookups", () => {
  const read = (second: number, id: string, file: string): TranscriptLine[] => [toolUse(second, id, "Read", { file_path: `${CWD}/${file}` }), toolResult(second + 1, id, "content")];

  it("merges two or more consecutive lookups into one row with the first id", () => {
    const lines = [
      ...read(1, "r1", "a.ts"),
      toolUse(3, "g1", "Grep", { pattern: "foo" }),
      toolResult(4, "g1", "match"),
      toolUse(5, "s1", "Glob", { pattern: "*.md" }),
      toolResult(6, "s1", "x.md"),
      toolUse(7, "ts", "ToolSearch", { query: "select:X" }),
      toolResult(8, "ts", "found"),
    ];
    expect(mapActivities(lines, OPTIONS)).toEqual([
      { kind: "tool", id: "r1", ts: at(1), tool: "Read", title: "Looked through 4 files", status: "ok", hasDetail: true, durationMs: null },
    ]);
  });

  it("counts distinct targets and says '1 file' for the same file read twice", () => {
    expect(titles([...read(1, "r1", "a.ts"), ...read(3, "r2", "a.ts"), ...read(5, "r3", "b.ts")])).toEqual(["Looked through 2 files"]);
    expect(titles([...read(1, "r1", "a.ts"), ...read(3, "r2", "a.ts")])).toEqual(["Looked through 1 file"]);
  });

  it("does not merge a single lookup, and text, prompts, failures or running calls break a run", () => {
    expect(titles(read(1, "r1", "a.ts"))).toEqual(["Read a.ts"]);
    expect(titles([...read(1, "r1", "a.ts"), say(3, "hm"), ...read(4, "r2", "b.ts")])).toEqual(["Read a.ts", "assistant", "Read b.ts"]);
    expect(titles([...read(1, "r1", "a.ts"), user(3, "and?"), ...read(4, "r2", "b.ts")])).toEqual(["Read a.ts", "user", "Read b.ts"]);
    const failed = [toolUse(3, "r2", "Read", { file_path: `${CWD}/b.ts` }), toolResult(4, "r2", "no such file", { isError: true }), ...read(5, "r3", "c.ts")];
    expect(titles([...read(1, "r1", "a.ts"), ...failed])).toEqual(["Read a.ts", "Read b.ts", "Read c.ts"]);
    expect(titles([...read(1, "r1", "a.ts"), toolUse(3, "r2", "Read", { file_path: `${CWD}/b.ts` })])).toEqual(["Read a.ts", "Read b.ts"]);
  });

  it("merges across skipped lines such as thinking and meta lines", () => {
    const lines = [...read(1, "r1", "a.ts"), assistant(3, [{ type: "thinking", thinking: "x" }]), user(4, "hook noise", { isMeta: true }), ...read(5, "r2", "b.ts")];
    expect(titles(lines)).toEqual(["Looked through 2 files"]);
  });

  it("does not merge lookups with edits", () => {
    const edit = [toolUse(3, "e1", "Edit", { file_path: `${CWD}/a.ts` }), toolResult(4, "e1", "ok", { line: { toolUseResult: editResult(`${CWD}/a.ts`) } })];
    expect(titles([...read(1, "r1", "a.ts"), ...edit])).toEqual(["Read a.ts", "Edited a.ts"]);
  });
});

describe("merging edits", () => {
  function edit(second: number, id: string, file: string, tool = "Edit"): TranscriptLine[] {
    const path = `${CWD}/${file}`;
    return [toolUse(second, id, tool, { file_path: path }), toolResult(second + 1, id, "ok", { line: { toolUseResult: editResult(path) } })];
  }

  it("merges consecutive edits of several files into one files row with relative paths", () => {
    const lines = [...edit(1, "e1", "src/a.ts"), ...edit(3, "e2", "src/b.ts"), ...edit(5, "e3", "src/a.ts"), ...edit(7, "w1", "docs/new.md", "Write")];
    const rows = mapActivities(lines, OPTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "files", id: "e1", title: "Edited 3 files", changed: ["src/a.ts", "src/b.ts", "docs/new.md"] });
  });

  it("keeps one distinct file edited several times as a single tool row", () => {
    const rows = mapActivities([...edit(1, "e1", "a.ts"), ...edit(3, "e2", "a.ts")], OPTIONS);
    expect(rows).toMatchObject([{ kind: "tool", id: "e1", title: "Edited a.ts", status: "ok", hasDetail: true, durationMs: null }]);
  });

  it("a merged single-file run without any diff has no detail", () => {
    const bare = (second: number, id: string): TranscriptLine[] => [toolUse(second, id, "Edit", { file_path: `${CWD}/a.ts` }), toolResult(second + 1, id, "ok")];
    expect(mapActivities([...bare(1, "e1"), ...bare(3, "e2")], OPTIONS)).toMatchObject([{ title: "Edited a.ts", hasDetail: false }]);
  });

  it("does not merge a failed or running edit, or edits split by text", () => {
    const failed = [toolUse(3, "e2", "Edit", { file_path: `${CWD}/b.ts` }), toolResult(4, "e2", "no match", { isError: true })];
    expect(titles([...edit(1, "e1", "a.ts"), ...failed, ...edit(5, "e3", "c.ts")])).toEqual(["Edited a.ts", "Edited b.ts", "Edited c.ts"]);
    expect(titles([...edit(1, "e1", "a.ts"), say(3, "next"), ...edit(4, "e2", "b.ts")])).toEqual(["Edited a.ts", "assistant", "Edited b.ts"]);
    expect(titles([...edit(1, "e1", "a.ts"), toolUse(3, "e2", "Edit", { file_path: `${CWD}/b.ts` })])).toEqual(["Edited a.ts", "Edited b.ts"]);
  });
});

describe("stable ids", () => {
  it("keeps the ids of complete rows when more lines arrive", () => {
    const lines = [user(1, "go"), toolUse(2, "t1", "Read", { file_path: `${CWD}/a.ts` }), toolResult(3, "t1", "x"), say(4, "done"), toolUse(5, "t2", "Bash", { command: "ls" }), toolResult(6, "t2", "x")];
    const full = mapActivities(lines, OPTIONS).map((row) => row.id);
    const prefix = mapActivities(lines.slice(0, 4), OPTIONS).map((row) => row.id);
    expect(full.slice(0, prefix.length)).toEqual(prefix);
  });
});
