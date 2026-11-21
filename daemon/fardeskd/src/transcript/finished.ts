// Tool calls whose tool_result is in the transcript, with the exact input they were called with.
import { collect } from "./collect.js";
import type { TranscriptLine } from "./lineTypes.js";

export type FinishedToolCall = { id: string; tool: string; input: Record<string, unknown>; startedAt: string };

/** Only a real tool_result counts: a call without one that merely looks overtaken by later lines is not finished. */
export function finishedToolCalls(lines: readonly TranscriptLine[]): FinishedToolCall[] {
  return collect(lines).items.flatMap((item) =>
    item.type === "call" && item.call.result !== null
      ? [{ id: item.call.id, tool: item.call.name, input: item.call.input, startedAt: item.call.timestamp }]
      : [],
  );
}
