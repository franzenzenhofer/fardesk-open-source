import { describe, expect, it } from "vitest";
import { sleep } from "../../test/support/env.js";
import { createInputQueue, userMessage } from "./inputQueue.js";

describe("input queue", () => {
  it("builds the SDK user message shape", () => {
    expect(userMessage("hi")).toEqual({ type: "user", message: { role: "user", content: "hi" }, parent_tool_use_id: null });
  });

  it("sends images as base64 content blocks after the text", () => {
    expect(userMessage("see this", [{ mediaType: "image/png", data: "AAAA" }]).message.content).toEqual([
      { type: "text", text: "see this" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
    ]);
  });

  it("delivers queued and later pushed messages in order, then ends on close", async () => {
    const queue = createInputQueue();
    queue.push(userMessage("one"));
    const seen: string[] = [];
    const reader = (async (): Promise<void> => {
      for await (const message of queue.messages) seen.push(JSON.stringify(message.message.content));
    })();
    await sleep(20);
    queue.push(userMessage("two"));
    await sleep(20);
    expect(seen).toEqual(["\"one\"", "\"two\""]);
    queue.close();
    await reader;
    expect(seen).toEqual(["\"one\"", "\"two\""]);
  });
});
