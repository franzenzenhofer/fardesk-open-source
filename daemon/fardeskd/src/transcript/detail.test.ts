import { describe, expect, it } from "vitest";
import { activityDetailSchema } from "../contract/schema.js";
import { CWD, parseFixture, toolResult, toolUse, user } from "../../test/support/transcriptLines.js";
import { OUTPUT_TITLE_MAX, buildDetail } from "./detail.js";
import type { DetailOptions } from "./detail.js";
import type { TranscriptLine } from "./lineTypes.js";

const OPTIONS: DetailOptions = { cwd: CWD, maxOutputLines: 5, maxDiffLines: 400 };
const FIXTURE_OPTIONS: DetailOptions = { cwd: "/Users/dev/dev/smear-studio", maxOutputLines: 40, maxDiffLines: 400 };

function hunk(oldStart: number, newStart: number, lines: string[]): Record<string, unknown> {
  return { oldStart, oldLines: lines.length, newStart, newLines: lines.length, lines };
}

function edited(second: number, id: string, file: string, patch: unknown[]): TranscriptLine[] {
  const path = `${CWD}/${file}`;
  return [
    toolUse(second, id, "Edit", { file_path: path }),
    toolResult(second + 1, id, "ok", { line: { toolUseResult: { filePath: path, structuredPatch: patch } } }),
  ];
}

function bash(second: number, id: string, command: string, result: Record<string, unknown>): TranscriptLine[] {
  return [toolUse(second, id, "Bash", { command }), toolResult(second + 1, id, "fallback text", { line: { toolUseResult: result } })];
}

describe("diff detail", () => {
  it("numbers lines from the real structuredPatch of fixture 05 (new numbers for context and +, old for -)", () => {
    const detail = buildDetail(parseFixture("05-edit-write-read-test-run"), "toolu_162lOzm1XvHp93OmKsSahCTO", FIXTURE_OPTIONS);
    expect(activityDetailSchema.parse(detail)).toEqual(detail);
    const [section] = detail.sections;
    expect(detail).toMatchObject({ kind: "diff", truncated: false });
    expect(section).toMatchObject({ title: "notes21.md", subtitle: "docs", added: 2, removed: 1 });
    expect(section?.lines.map((line) => [line.number, line.sign])).toEqual([
      [62, " "],
      [63, " "],
      [64, " "],
      [65, "-"],
      [65, "+"],
      [66, "+"],
    ]);
  });

  it("shows a created file (empty patch) as all added lines", () => {
    const detail = buildDetail(parseFixture("05-edit-write-read-test-run"), "toolu_7554uYg2d246hlrgMQk1X8pH", FIXTURE_OPTIONS);
    const [section] = detail.sections;
    expect(section).toMatchObject({ title: "file20.sh", removed: 0 });
    expect(section?.added).toBe(section?.lines.length);
    expect(section?.lines[0]).toMatchObject({ number: 1, sign: "+" });
    expect(section?.lines.every((line) => line.sign === "+")).toBe(true);
  });

  it("numbers several hunks independently and drops trailing newline of created content", () => {
    const lines = edited(1, "e1", "a.ts", [hunk(1, 1, [" keep", "-old", "+new"]), hunk(40, 41, [" far", "+later", "-gone"])]);
    const detail = buildDetail(lines, "e1", OPTIONS);
    expect(detail.sections[0]?.lines.map((line) => [line.number, line.sign, line.text])).toEqual([
      [1, " ", "keep"],
      [2, "-", "old"],
      [2, "+", "new"],
      [41, " ", "far"],
      [42, "+", "later"],
      [41, "-", "gone"],
    ]);
    const created = [toolUse(1, "w1", "Write", { file_path: `${CWD}/n.txt` }), toolResult(2, "w1", "ok", { line: { toolUseResult: { filePath: `${CWD}/n.txt`, structuredPatch: [], content: "one\ntwo\n" } } })];
    expect(buildDetail(created, "w1", OPTIONS).sections[0]).toMatchObject({ added: 2, lines: [{ number: 1, text: "one" }, { number: 2, text: "two" }] });
  });

  it("caps each section at maxDiffLines and marks the detail truncated, counting every line", () => {
    const many = Array.from({ length: 10 }, (_unused, index) => `+line ${index}`);
    const detail = buildDetail(edited(1, "e1", "a.ts", [hunk(1, 1, many)]), "e1", { ...OPTIONS, maxDiffLines: 4 });
    expect(detail.truncated).toBe(true);
    expect(detail.sections[0]).toMatchObject({ added: 10 });
    expect(detail.sections[0]?.lines).toHaveLength(4);
  });

  it("builds one section per file for a merged files row, joining repeated edits of one file", () => {
    const lines = [
      ...edited(1, "e1", "src/a.ts", [hunk(1, 1, ["-x", "+y"])]),
      ...edited(3, "e2", "b.ts", [hunk(1, 1, ["+z"])]),
      ...edited(5, "e3", "src/a.ts", [hunk(9, 9, ["-p", "+q"])]),
    ];
    const detail = buildDetail(lines, "e1", OPTIONS);
    expect(detail.sections.map((section) => [section.title, section.subtitle, section.added, section.removed])).toEqual([
      ["a.ts", "src", 2, 2],
      ["b.ts", "", 1, 0],
    ]);
  });

  it("skips files whose calls have no diff content in a merged row", () => {
    const bare = [toolUse(1, "e0", "Edit", { file_path: `${CWD}/none.ts` }), toolResult(2, "e0", "ok", { line: { toolUseResult: { filePath: `${CWD}/none.ts`, structuredPatch: [] } } })];
    const plain = [toolUse(7, "e9", "Edit", { file_path: `${CWD}/plain.ts` }), toolResult(8, "e9", "ok")];
    const lines = [...bare, ...edited(3, "e1", "b.ts", [hunk(1, 1, ["+z"])]), ...plain];
    const detail = buildDetail(lines, "e0", OPTIONS);
    expect(detail.sections.map((section) => section.title)).toEqual(["b.ts"]);
  });
});

describe("output detail", () => {
  it("shows the last maxOutputLines lines of stdout then stderr", () => {
    const stdout = Array.from({ length: 8 }, (_unused, index) => `out ${index}`).join("\n");
    const detail = buildDetail(bash(1, "b1", "npm test", { stdout: `${stdout}\n`, stderr: "warn 1\nwarn 2" }), "b1", OPTIONS);
    expect(detail).toMatchObject({ kind: "output", truncated: true });
    expect(detail.sections).toHaveLength(1);
    expect(detail.sections[0]).toMatchObject({ title: "npm test", subtitle: "", added: 0, removed: 0 });
    expect(detail.sections[0]?.lines.map((line) => [line.number, line.sign, line.text])).toEqual([
      [null, " ", "out 5"],
      [null, " ", "out 6"],
      [null, " ", "out 7"],
      [null, " ", "warn 1"],
      [null, " ", "warn 2"],
    ]);
  });

  it("is not truncated when everything fits and uses stderr alone when stdout is empty", () => {
    const detail = buildDetail(bash(1, "b1", "make", { stdout: "", stderr: "only err" }), "b1", OPTIONS);
    expect(detail.truncated).toBe(false);
    expect(detail.sections[0]?.lines).toEqual([{ number: null, sign: " ", text: "only err" }]);
  });

  it("uses the result text for tools without stdout, titled with the row title", () => {
    const lines = [toolUse(1, "m1", "Monitor", { command: "echo hi" }), toolResult(2, "m1", "watching", { line: { toolUseResult: { taskId: "x" } } })];
    const detail = buildDetail(lines, "m1", OPTIONS);
    expect(detail.sections[0]).toMatchObject({ title: "echo hi", lines: [{ text: "watching" }] });
    const web = [toolUse(1, "w1", "WebFetch", { url: "https://example.com/a" }), toolResult(2, "w1", "summary text")];
    expect(buildDetail(web, "w1", OPTIONS).sections[0]).toMatchObject({ title: "Fetched example.com", lines: [{ text: "summary text" }] });
  });

  it("shows the output of a failed edit and caps a very long command title", () => {
    const failed = [toolUse(1, "e1", "Edit", { file_path: `${CWD}/a.ts` }), toolResult(2, "e1", "String not found", { isError: true })];
    expect(buildDetail(failed, "e1", OPTIONS).sections[0]).toMatchObject({ title: "Edited a.ts", lines: [{ text: "String not found" }] });
    const long = buildDetail(bash(1, "b1", `echo ${"x".repeat(300)}`, { stdout: "x", stderr: "" }), "b1", OPTIONS);
    expect(long.sections[0]?.title).toHaveLength(OUTPUT_TITLE_MAX);
  });

  it("reads Bash output of fixture 05 from the real result", () => {
    const detail = buildDetail(parseFixture("05-edit-write-read-test-run"), "toolu_733jxy1RgifEHuSJLq2EqL0s", FIXTURE_OPTIONS);
    expect(detail).toMatchObject({ kind: "output", truncated: false });
    expect(detail.sections[0]?.title).toBe("echo step-12");
    expect(detail.sections[0]?.lines.length).toBeGreaterThan(0);
  });
});

describe("lookup detail", () => {
  const lookups = (): TranscriptLine[] => [
    toolUse(1, "r1", "Read", { file_path: `${CWD}/src/a.ts` }),
    toolResult(2, "r1", "x"),
    toolUse(3, "g1", "Grep", { pattern: "needle" }),
    toolResult(4, "g1", "x"),
    toolUse(5, "r2", "Read", { file_path: `${CWD}/src/a.ts` }),
    toolResult(6, "r2", "x"),
    toolUse(7, "s1", "ToolSearch", { query: "select:Z" }),
    toolResult(8, "s1", "x"),
    toolUse(9, "l1", "Glob", { pattern: "*.md" }),
    toolResult(10, "l1", "x"),
  ];

  it("lists each distinct file or pattern as a line", () => {
    const detail = buildDetail(lookups(), "r1", { ...OPTIONS, maxOutputLines: 10 });
    expect(detail).toMatchObject({ kind: "output", truncated: false });
    expect(detail.sections[0]).toMatchObject({ title: "Looked through 4 files" });
    expect(detail.sections[0]?.lines.map((line) => line.text)).toEqual(["src/a.ts", "Grep: needle", "ToolSearch: select:Z", "Glob: *.md"]);
  });

  it("truncates the listing at maxOutputLines", () => {
    const detail = buildDetail(lookups(), "r1", { ...OPTIONS, maxOutputLines: 2 });
    expect(detail.truncated).toBe(true);
    expect(detail.sections[0]?.lines).toHaveLength(2);
  });
});

describe("errors", () => {
  const lines = [
    user(1, "hi"),
    ...bash(2, "b1", "ls", { stdout: "x", stderr: "" }),
    toolUse(4, "d1", "Bash", { command: "rm x" }),
    toolResult(5, "d1", "denied", { isError: true, line: { toolDenialKind: "user-rejected", toolUseResult: "User rejected tool use" } }),
    toolUse(6, "run", "Bash", { command: "sleep 9" }),
  ];

  it.each([
    ["an unknown id", "nope"],
    ["a text row", "line-1"],
    ["a denied tool", "d1"],
    ["a running tool", "run"],
  ])("throws not_found for %s", (_name, id) => {
    expect(() => buildDetail(lines, id, OPTIONS)).toThrow(expect.objectContaining({ code: "not_found" }));
  });
});
