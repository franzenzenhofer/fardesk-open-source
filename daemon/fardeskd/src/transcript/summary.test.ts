import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixturePath } from "../../test/support/env.js";
import { CWD, at, parseFixture, parseObject, say, toolResult, toolUse, user } from "../../test/support/transcriptLines.js";
import type { TranscriptLine } from "./lineTypes.js";
import { mapActivities } from "./mapper.js";
import { summarise } from "./summary.js";

const MAX = 80;

describe("summarise", () => {
  it("is empty for no lines", () => {
    expect(summarise([], MAX)).toEqual({
      title: null,
      summary: "",
      cwd: null,
      model: null,
      permissionMode: null,
      startedAt: null,
      updatedAt: null,
      pendingToolUse: false,
      contextTokens: null,
      cacheExpiresAt: null,
    });
  });

  it("takes the last sentence of the last assistant text and the header facts", () => {
    const lines = [
      user(1, "go", { permissionMode: "acceptEdits" }),
      say(2, "First thing. I changed the engine and the tests pass! Anything else?"),
      say(3, "All set.\n\nThe build is green. Ship it."),
    ];
    expect(summarise(lines, MAX)).toEqual({
      title: null,
      summary: "Ship it.",
      cwd: CWD,
      model: "claude-test",
      permissionMode: "acceptEdits",
      startedAt: at(1),
      updatedAt: at(3),
      pendingToolUse: false,
      contextTokens: null,
      cacheExpiresAt: null,
    });
  });

  it("trims the sentence to maxChars with an ellipsis", () => {
    const summary = summarise([say(1, `${"word ".repeat(40)}end.`)], 30).summary;
    expect(summary).toHaveLength(30);
    expect(summary.endsWith("...")).toBe(true);
  });

  it("uses the title of a running tool and flags the pending tool use", () => {
    const lines = [say(1, "Running the tests."), toolUse(2, "t1", "Bash", { command: "swift test" })];
    expect(summarise(lines, MAX)).toMatchObject({ summary: "Running swift test...", pendingToolUse: true });
  });

  it("goes back to the last sentence once the tool is done", () => {
    const lines = [say(1, "Running the tests."), toolUse(2, "t1", "Bash", { command: "swift test" }), toolResult(3, "t1", "ok")];
    expect(summarise(lines, MAX)).toMatchObject({ summary: "Running the tests.", pendingToolUse: false });
  });

  it("prefers a custom title over the ai title and the latest of each wins", () => {
    const ai = (title: string): TranscriptLine => parseObject({ type: "ai-title", aiTitle: title });
    const custom = (title: string): TranscriptLine => parseObject({ type: "agent-name", agentName: title });
    expect(summarise([ai("one"), ai("two")], MAX).title).toBe("two");
    expect(summarise([ai("one"), custom("mine"), ai("two"), custom("renamed")], MAX).title).toBe("renamed");
    expect(summarise([custom("mine"), ai("auto")], MAX).title).toBe("mine");
  });

  it("tracks the latest permission mode from mode lines and prompts, and ignores sidechains", () => {
    const mode = (permissionMode: string): TranscriptLine => parseObject({ type: "permission-mode", permissionMode });
    expect(summarise([user(1, "a", { permissionMode: "plan" }), mode("bypassPermissions")], MAX).permissionMode).toBe("bypassPermissions");
    expect(summarise([mode("plan"), user(2, "b", { permissionMode: "default" })], MAX).permissionMode).toBe("default");
    expect(summarise([user(1, "a", { permissionMode: "plan" }), say(2, "no mode")], MAX).permissionMode).toBe("plan");
    const side = summarise([say(1, "main."), user(2, "side", { isSidechain: true, cwd: "/elsewhere", permissionMode: "x" })], MAX);
    expect(side).toMatchObject({ cwd: CWD, permissionMode: null, updatedAt: at(1) });
  });

  it("summarises the real fixtures", () => {
    const peer = summarise(parseFixture("31-peer-message-wrapper"), MAX);
    expect(peer).toMatchObject({ summary: "FROMTEST", cwd: "/Users/dev/project", pendingToolUse: false, permissionMode: "bypassPermissions" });
    expect(summarise(parseFixture("27-unfinished-tool-use-cut"), MAX)).toMatchObject({ pendingToolUse: true, summary: "Running echo step-68..." });
  });
  it("gives the same summary from prebuilt rows as from building them itself, for every fixture", () => {
    const names = readdirSync(fixturePath("transcripts")).filter((name) => name.endsWith(".jsonl"));
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) {
      const lines = parseFixture(name.replace(".jsonl", ""));
      const cwd = summarise(lines, MAX).cwd ?? "";
      const prebuilt = { cwd, activities: mapActivities(lines, { cwd }) };
      expect(summarise(lines, MAX, prebuilt), name).toEqual(summarise(lines, MAX));
    }
  });
});
