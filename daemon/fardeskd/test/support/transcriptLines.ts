// Builds real transcript lines (raw JSON in Claude Code's shape, parsed by the real parser) for tests.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseLine } from "../../src/transcript/lineSchema.js";
import type { TranscriptLine } from "../../src/transcript/lineTypes.js";
import { fixturePath, makeTempDir } from "./env.js";

const BASE_TIME_MS = Date.parse("2026-01-01T10:00:00.000Z");
const STEP_MS = 1_000;

export const CWD = "/work/project";

export function at(second: number): string {
  return new Date(BASE_TIME_MS + second * STEP_MS).toISOString();
}

export function parseObject(object: Record<string, unknown>): TranscriptLine {
  const line = parseLine(JSON.stringify(object));
  if (line === null) throw new Error(`line did not parse: ${JSON.stringify(object)}`);
  return line;
}

type Extra = Record<string, unknown>;

function conversation(second: number, extra: Extra): Extra {
  return { uuid: `line-${second}`, timestamp: at(second), isSidechain: false, cwd: CWD, ...extra };
}

export function user(second: number, content: unknown, extra: Extra = {}): TranscriptLine {
  return parseObject({ type: "user", message: { role: "user", content }, ...conversation(second, extra) });
}

export function assistant(second: number, content: unknown[], extra: Extra = {}): TranscriptLine {
  const message = { role: "assistant", id: `msg-${second}`, model: "claude-test", content };
  return parseObject({ type: "assistant", message, ...conversation(second, extra) });
}

export function say(second: number, text: string): TranscriptLine {
  return assistant(second, [{ type: "text", text }]);
}

export function toolUse(second: number, id: string, name: string, input: Extra): TranscriptLine {
  return assistant(second, [{ type: "tool_use", id, name, input }]);
}

type ResultOptions = { isError?: boolean; line?: Extra };

export function toolResult(second: number, id: string, content: unknown, options: ResultOptions = {}): TranscriptLine {
  const block = { type: "tool_result", tool_use_id: id, content, is_error: options.isError === true };
  return user(second, [block], options.line ?? {});
}

export function system(second: number, subtype: string, extra: Extra = {}): TranscriptLine {
  return parseObject({ type: "system", subtype, ...conversation(second, extra) });
}

export function readFixture(name: string): string[] {
  return readFileSync(fixturePath("transcripts", `${name}.jsonl`), "utf8").split("\n");
}

export function parseFixture(name: string): TranscriptLine[] {
  return readFixture(name).flatMap((raw) => {
    const line = parseLine(raw);
    return line === null ? [] : [line];
  });
}

export function titleLine(title: string): string {
  return JSON.stringify({ type: "ai-title", aiTitle: title });
}

export function makeTempFile(content: string, name = "session.jsonl"): string {
  const path = join(makeTempDir(), name);
  writeFileSync(path, content);
  return path;
}
