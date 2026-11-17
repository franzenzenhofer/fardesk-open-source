import { describe, expect, it } from "vitest";
import { at, parseObject, user } from "../../test/support/transcriptLines.js";
import { createParseStats, parseLine } from "./lineSchema.js";
import type { TranscriptLine } from "./lineTypes.js";
import { mapActivities } from "./mapper.js";
import { PEER_PREFIX, PEER_SUFFIX_START } from "./userText.js";

const PROMPT = "Reply with only the word WALNUT";

function queuedAttachment(second: number, prompt: unknown, extra: Record<string, unknown> = {}): TranscriptLine {
  return parseObject({
    type: "attachment",
    uuid: `att-${second}`,
    timestamp: at(second),
    cwd: "/work/project",
    attachment: { type: "queued_command", prompt, commandMode: "prompt", origin: { kind: "human" }, ...extra },
  });
}

describe("queued_command attachment lines", () => {
  it("parse into a queued user line with the prompt as text", () => {
    expect(queuedAttachment(3, PROMPT)).toMatchObject({
      type: "user",
      uuid: "att-3",
      timestamp: at(3),
      queuedPrompt: true,
      originKind: "human",
      isMeta: false,
      blocks: [{ type: "text", text: PROMPT }],
    });
  });

  it("are skipped, not invalid, when they are not a prompt", () => {
    const stats = createParseStats();
    const base = { type: "attachment", uuid: "a", timestamp: at(1) };
    const notifications = { type: "queued_command", prompt: "<task-notification>x</task-notification>", commandMode: "task-notification" };
    expect(parseLine(JSON.stringify({ ...base, attachment: notifications }), stats)).toBeNull();
    expect(parseLine(JSON.stringify({ ...base, attachment: { type: "queued_command", prompt: 5, commandMode: "prompt" } }), stats)).toBeNull();
    expect(parseLine(JSON.stringify({ ...base, attachment: { type: "hook_success" } }), stats)).toBeNull();
    expect(stats).toEqual({ parsed: 0, blank: 0, invalid: 0, skipped: 3 });
  });

  it("make a user row, and queue-operation lines make none", () => {
    const operations = [
      { operation: "enqueue", content: PROMPT },
      { operation: "remove", content: PROMPT, reason: "absorbed_mid_turn" },
      { operation: "remove", content: "gone", reason: "cancelled" },
    ];
    for (const operation of operations) {
      expect(parseLine(JSON.stringify({ type: "queue-operation", timestamp: at(2), ...operation }))).toBeNull();
    }
    const rows = mapActivities([user(1, "first"), queuedAttachment(3, PROMPT)], { cwd: "/work/project" });
    expect(rows.map((row) => [row.kind, row.id])).toEqual([
      ["user", "line-1"],
      ["user", "att-3"],
    ]);
    expect(rows[1]).toMatchObject({ text: PROMPT, ts: at(3) });
  });

  it("show once when a real user line with the same text follows", () => {
    const rows = mapActivities([queuedAttachment(3, PROMPT), user(4, PROMPT), user(5, PROMPT)], { cwd: "/work/project" });
    expect(rows.map((row) => row.id)).toEqual(["att-3", "line-5"]);
  });

  it("keep a prompt given as content blocks (a message with an attached image, observed 2026-11-16 on a Mac)", () => {
    const blocks = [
      { type: "text", text: "What single color is the attached image?\nAttached image: /work/.fardesk/attachments/red.png" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ];
    const line = queuedAttachment(3, blocks);
    expect(line).toMatchObject({ queuedPrompt: true, blocks: [{ type: "text" }, { type: "image" }] });
    const rows = mapActivities([queuedAttachment(2, PROMPT), line], { cwd: "/work/project" });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "user", id: "att-3" });
    expect(rows[1]).toHaveProperty("text", expect.stringContaining("What single color is the attached image?"));
    expect(parseLine(JSON.stringify({ type: "attachment", uuid: "e", timestamp: at(4), attachment: { type: "queued_command", prompt: [], commandMode: "prompt" } }))).toBeNull();
  });

  it("unwrap the peer wrapper like a user line does", () => {
    const wrapped = `${PEER_PREFIX}${PROMPT}${PEER_SUFFIX_START} - not typed by your user.`;
    const rows = mapActivities([queuedAttachment(3, wrapped, { origin: { kind: "peer" } })], { cwd: "/work/project" });
    expect(rows).toMatchObject([{ kind: "user", text: PROMPT }]);
  });
});
