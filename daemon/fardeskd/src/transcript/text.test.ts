import { describe, expect, it } from "vitest";
import { baseName, cleanForTitle, dirOf, firstLine, plural, relativeToCwd, splitLines, truncate } from "./text.js";

describe("truncate", () => {
  it.each([
    ["short", 10, "short"],
    ["exactly ten", 11, "exactly ten"],
    ["a longer sentence here", 10, "a longe..."],
    ["abcdefghij", 8, "abcde..."],
  ])("%j at %i -> %j", (text, max, expected) => {
    expect(truncate(text, max)).toBe(expected);
  });

  it("never exceeds the limit", () => {
    expect(truncate("x".repeat(100), 48)).toHaveLength(48);
  });
});

describe("firstLine / cleanForTitle / plural", () => {
  it("takes the first line, trimmed", () => {
    expect(firstLine("  npm test\nsecond")).toBe("npm test");
    expect(firstLine("single")).toBe("single");
  });

  it("removes backticks, dashes and runs of whitespace", () => {
    expect(cleanForTitle("a `b` — c – d\t\te")).toBe("a 'b' - c - d e");
  });

  it("picks the singular for exactly one", () => {
    expect(plural(1, "file", "files")).toBe("file");
    expect(plural(2, "file", "files")).toBe("files");
    expect(plural(0, "file", "files")).toBe("files");
  });
});

describe("paths", () => {
  it("makes paths relative to the cwd only when they are inside it", () => {
    expect(relativeToCwd("/work/p/src/a.ts", "/work/p")).toBe("src/a.ts");
    expect(relativeToCwd("/work/p/src/a.ts", "/work/p/")).toBe("src/a.ts");
    expect(relativeToCwd("/work/other/a.ts", "/work/p")).toBe("/work/other/a.ts");
    expect(relativeToCwd("/work/pp/a.ts", "/work/p")).toBe("/work/pp/a.ts");
  });

  it("gives base name and directory", () => {
    expect(baseName("/work/p/src/a.ts")).toBe("a.ts");
    expect(dirOf("/work/p/src/a.ts", "/work/p")).toBe("src");
    expect(dirOf("/work/p/a.ts", "/work/p")).toBe("");
    expect(dirOf("/etc/hosts", "/work/p")).toBe("/etc");
  });
});

describe("splitLines", () => {
  it.each([
    ["a\nb", ["a", "b"]],
    ["a\nb\n", ["a", "b"]],
    ["a\n\nb", ["a", "", "b"]],
    ["", []],
    ["\n", [""]],
  ])("%j -> %j", (text, expected) => {
    expect(splitLines(text)).toEqual(expected);
  });
});
