import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { OwnedImage } from "./types.js";

export type InputQueue = {
  push(message: SDKUserMessage): void;
  close(): void;
  messages: AsyncIterable<SDKUserMessage>;
};

type QueueState = { queue: SDKUserMessage[]; closed: boolean; wake: (() => void) | null };

export function userMessage(text: string, images: OwnedImage[] = []): SDKUserMessage {
  if (images.length === 0) return { type: "user", message: { role: "user", content: text }, parent_tool_use_id: null };
  const blocks = images.map((image) => ({
    type: "image" as const,
    source: { type: "base64" as const, media_type: image.mediaType, data: image.data },
  }));
  return { type: "user", message: { role: "user", content: [{ type: "text", text }, ...blocks] }, parent_tool_use_id: null };
}

function wakeReader(state: QueueState): void {
  state.wake?.();
  state.wake = null;
}

async function* drainQueue(state: QueueState): AsyncGenerator<SDKUserMessage> {
  for (;;) {
    const next = state.queue.shift();
    if (next !== undefined) {
      yield next;
    } else if (state.closed) {
      return;
    } else {
      await new Promise<void>((resolve) => {
        state.wake = resolve;
      });
    }
  }
}

export function createInputQueue(): InputQueue {
  const state: QueueState = { queue: [], closed: false, wake: null };
  return {
    push(message): void {
      state.queue.push(message);
      wakeReader(state);
    },
    close(): void {
      state.closed = true;
      wakeReader(state);
    },
    messages: drainQueue(state),
  };
}
