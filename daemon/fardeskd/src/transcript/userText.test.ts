import { describe, expect, it } from "vitest";
import { parseFixture, user } from "../../test/support/transcriptLines.js";
import type { UserLine } from "./lineTypes.js";
import { PEER_PREFIX, PEER_SUFFIX_START, userRowOf } from "./userText.js";

function userLine(content: unknown, extra: Record<string, unknown> = {}): UserLine {
  const line = user(1, content, extra);
  if (line.type !== "user") throw new Error("expected a user line");
  return line;
}

describe("userRowOf", () => {
  it("keeps a plain prompt", () => {
    expect(userRowOf(userLine("fix the build"))).toEqual({ kind: "user", text: "fix the build" });
  });

  it("joins several text blocks and marks images", () => {
    const content = [{ type: "text", text: "look at this" }, { type: "image", source: {} }, { type: "text", text: "  " }];
    expect(userRowOf(userLine(content))).toEqual({ kind: "user", text: "look at this\n[image]" });
  });

  it.each([
    ["tool results only", [{ type: "tool_result", tool_use_id: "t1", content: "ok" }]],
    ["an empty string", ""],
    ["only a system reminder", "<system-reminder>\nuse the tools\n</system-reminder>"],
    ["a local command caveat", "<local-command-caveat>The command below was run directly</local-command-caveat>"],
    ["local command output", "<local-command-stdout>Catch you later!</local-command-stdout>"],
    ["a task notification", "<task-notification>\n<task-id>x</task-id>\n</task-notification>"],
    ["a reminder cut off before its closing tag", "<system-reminder>\ntruncated forever"],
  ])("drops %s", (_name, content) => {
    expect(userRowOf(userLine(content))).toBeNull();
  });

  it("strips harness blocks out of a prompt and keeps the rest", () => {
    const text = "build it\n\n<system-reminder>\nnoise\n</system-reminder>\nplease";
    expect(userRowOf(userLine(text))).toEqual({ kind: "user", text: "build it\n\n\nplease" });
  });

  it("turns a slash command into its typed form", () => {
    const withArgs = "<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>";
    expect(userRowOf(userLine(withArgs))).toEqual({ kind: "user", text: "/model opus" });
    const bare = "<command-name>/clear</command-name><command-message>clear</command-message><command-args></command-args>";
    expect(userRowOf(userLine(bare))).toEqual({ kind: "user", text: "/clear" });
    expect(userRowOf(userLine("<command-name>/exit</command-name>"))).toEqual({ kind: "user", text: "/exit" });
  });

  it.each(["[Request interrupted by user]", "[Request interrupted by user for tool use]"])("maps %s to Interrupted", (marker) => {
    expect(userRowOf(userLine([{ type: "text", text: marker }]))).toEqual({ kind: "system", text: "Interrupted" });
  });

  it("skips meta lines and compact summaries", () => {
    expect(userRowOf(userLine("hook feedback", { isMeta: true }))).toBeNull();
    expect(userRowOf(userLine("This session is being continued", { isCompactSummary: true }))).toBeNull();
  });

  describe("peer messages", () => {
    const wrapped = `${PEER_PREFIX}Reply with ACK.${PEER_SUFFIX_START} - not typed by your user.`;
    const peer = { isMeta: true, origin: { kind: "peer", from: "unknown" } };

    it("removes the wrapper boilerplate and keeps the message", () => {
      expect(userRowOf(userLine(wrapped, peer))).toEqual({ kind: "user", text: "Reply with ACK." });
    });

    it("keeps a peer text that has no wrapper", () => {
      expect(userRowOf(userLine("plain peer text", peer))).toEqual({ kind: "user", text: "plain peer text" });
    });

    it("keeps a peer text with a prefix but no suffix", () => {
      expect(userRowOf(userLine(`${PEER_PREFIX}Only the start`, peer))).toEqual({ kind: "user", text: "Only the start" });
    });

    it("does not treat other origins as peer", () => {
      expect(userRowOf(userLine(wrapped, { isMeta: true, origin: { kind: "human" } }))).toBeNull();
    });

    it("reads the two real peer lines of fixture 31 (boilerplate kept verbatim)", () => {
      const rows = parseFixture("31-peer-message-wrapper").flatMap((line) => {
        const row = line.type === "user" ? userRowOf(line) : null;
        return row === null ? [] : [row];
      });
      expect(rows).toEqual([
        { kind: "user", text: "Reply with the single word ACKTEST. Do not use tools." },
        { kind: "user", text: "Reply with the single word FROMTEST. Do not use tools." },
      ]);
    });
  });
});
