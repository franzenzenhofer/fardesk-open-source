// Pass 1 over the main-chain lines: plain rows (user, assistant, system) in order, plus every
// tool call joined with its result. Tool rows are resolved later, once it is known how the
// conversation went on after each call.
import type { Activity } from "../contract/schema.js";
import { COMPACT_SUBTYPE, isConversationLine } from "./lineTypes.js";
import type { AssistantLine, SystemLine, TranscriptLine, UserLine } from "./lineTypes.js";
import { resultFromBlock } from "./toolCalls.js";
import type { ToolCall } from "./toolCalls.js";
import { truncate, firstLine } from "./text.js";
import { userRowOf } from "./userText.js";

export const ERROR_TEXT_MAX = 200;
export const COMPACTED_TEXT = "Conversation compacted";
export const API_ERROR_SUBTYPE = "api_error";
export const API_ERROR_FALLBACK = "API error";

export type Item = { type: "activity"; activity: Activity } | { type: "call"; call: ToolCall };
export type Collected = { items: Item[]; lastMoveSeq: number };

type State = { items: Item[]; calls: Map<string, ToolCall>; queuedTexts: Set<string>; seq: number; lastMoveSeq: number };

function tick(state: State): number {
  state.seq += 1;
  return state.seq;
}

// Anything the reader sees after a tool started proves that tool is not "running" any more.
function pushActivity(state: State, activity: Activity): void {
  state.items.push({ type: "activity", activity });
  state.lastMoveSeq = tick(state);
}

function systemText(line: SystemLine): string | null {
  if (line.subtype === COMPACT_SUBTYPE) return COMPACTED_TEXT;
  if (line.subtype !== API_ERROR_SUBTYPE) return null;
  return truncate(firstLine(line.errorMessage ?? API_ERROR_FALLBACK), ERROR_TEXT_MAX);
}

// A prompt absorbed mid-turn is shown from its queued_command attachment; if Claude Code later also
// writes a real user line with the same text, that line is the same delivery and must not show twice.
function isAlreadyShown(state: State, line: UserLine, text: string): boolean {
  if (line.queuedPrompt) {
    state.queuedTexts.add(text);
    return false;
  }
  return state.queuedTexts.delete(text);
}

function addUser(state: State, line: UserLine): void {
  for (const block of line.blocks) {
    if (block.type !== "tool_result") continue;
    const call = state.calls.get(block.toolUseId);
    if (call !== undefined) call.result = resultFromBlock(line, block);
    state.lastMoveSeq = tick(state);
  }
  const row = userRowOf(line);
  if (row !== null && isAlreadyShown(state, line, row.text)) return;
  if (row !== null) pushActivity(state, { kind: row.kind, id: line.uuid, ts: line.timestamp, text: row.text });
}

function addAssistant(state: State, line: AssistantLine): void {
  line.blocks.forEach((block, index) => {
    const id = index === 0 ? line.uuid : `${line.uuid}#${index}`;
    if (block.type === "tool_use") {
      const call: ToolCall = {
        id: block.id,
        name: block.name,
        input: block.input,
        timestamp: line.timestamp,
        seq: tick(state),
        result: null,
      };
      state.calls.set(call.id, call);
      state.items.push({ type: "call", call });
    }
    if (block.type === "text" && block.text.trim() !== "") {
      pushActivity(state, { kind: "assistant", id, ts: line.timestamp, text: block.text.trim() });
    }
  });
}

function addSystem(state: State, line: SystemLine): void {
  const text = systemText(line);
  if (text !== null) pushActivity(state, { kind: "system", id: line.uuid, ts: line.timestamp, text });
}

function addLine(state: State, line: TranscriptLine): void {
  if (!isConversationLine(line) || line.isSidechain) return;
  if (line.type === "user") addUser(state, line);
  else if (line.type === "assistant") addAssistant(state, line);
  else addSystem(state, line);
}

export function collect(lines: readonly TranscriptLine[]): Collected {
  const state: State = { items: [], calls: new Map(), queuedTexts: new Set(), seq: 0, lastMoveSeq: 0 };
  for (const line of lines) addLine(state, line);
  return { items: state.items, lastMoveSeq: state.lastMoveSeq };
}
