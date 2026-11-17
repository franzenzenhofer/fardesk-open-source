import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { activityDetailSchema, activitySchema } from "../contract/schema.js";
import type { Activity } from "../contract/schema.js";
import { fixturePath } from "../../test/support/env.js";
import { parseFixture, readFixture } from "../../test/support/transcriptLines.js";
import { buildDetail } from "./detail.js";
import { isConversationLine } from "./lineTypes.js";
import { mapActivities } from "./mapper.js";
import { summarise } from "./summary.js";

const TRANSCRIPTS = fixturePath("transcripts");
const GOLDEN_DIR = fileURLToPath(new URL("./golden/", import.meta.url));
const FIXTURE_CWD = "/Users/dev/dev/smear-studio";
const SUMMARY_MAX = 80;
const DETAIL_LIMITS = { cwd: FIXTURE_CWD, maxOutputLines: 40, maxDiffLines: 400 };
const GOLDEN_FIXTURES = [
  "01b-minimal-session",
  "02-interrupt-denied-bash-error",
  "05-edit-write-read-test-run",
  "10-askuserquestion",
  "17-compaction-window",
  "27-unfinished-tool-use-cut",
  "31-peer-message-wrapper",
  "32-queued-prompt-absorbed-mid-turn",
];

const summarySchema = z.strictObject({
  title: z.string().nullable(),
  summary: z.string().max(SUMMARY_MAX),
  cwd: z.string().nullable(),
  model: z.string().nullable(),
  permissionMode: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  pendingToolUse: z.boolean(),
  contextTokens: z.number().int().nullable(),
  cacheExpiresAt: z.string().nullable(),
});

const names = readdirSync(TRANSCRIPTS)
  .filter((file) => file.endsWith(".jsonl"))
  .map((file) => file.replace(/\.jsonl$/, ""));

function thinkingTexts(name: string): string[] {
  const texts = readFixture(name).flatMap((raw) => {
    const found = [...raw.matchAll(/"thinking":"((?:[^"\\]|\\.)*)"/g)];
    return found.map((match) => JSON.parse(`"${match[1] ?? ""}"`) as string);
  });
  return texts.filter((text) => text.trim() !== "");
}

function stringsOf(activity: Activity): string[] {
  return Object.values(activity).flatMap((value) => (typeof value === "string" ? [value] : Array.isArray(value) ? value.map(String) : []));
}

describe.each(names)("fixture %s", (name) => {
  const lines = parseFixture(name);
  const rows = mapActivities(lines, { cwd: FIXTURE_CWD });

  it("maps to schema-valid rows with unique ids and ordered timestamps", () => {
    for (const row of rows) expect(activitySchema.safeParse(row).success, JSON.stringify(row)).toBe(true);
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    const sourceTimes = lines.filter(isConversationLine).filter((line) => !line.isSidechain).map((line) => line.timestamp);
    const sorted = [...sourceTimes].sort();
    if (sourceTimes.join() === sorted.join()) {
      const times = rows.map((row) => row.ts);
      expect(times).toEqual([...times].sort());
    }
  });

  it("never leaks thinking, system reminders or raw JSON", () => {
    const thinking = thinkingTexts(name);
    for (const row of rows) {
      for (const text of stringsOf(row)) {
        expect(thinking).not.toContain(text);
        expect(text).not.toContain("<system-reminder");
        expect(text).not.toContain('{"type":');
      }
    }
  });

  it("builds a schema-valid detail for every row that has one", () => {
    for (const row of rows) {
      if (row.kind === "tool" && !row.hasDetail) continue;
      if (row.kind !== "tool" && row.kind !== "files") continue;
      const detail = buildDetail(lines, row.id, DETAIL_LIMITS);
      expect(activityDetailSchema.safeParse(detail).success, row.id).toBe(true);
      expect(detail.activityId).toBe(row.id);
    }
  });

  it("summarises to schema-compatible values", () => {
    expect(summarySchema.safeParse(summarise(lines, SUMMARY_MAX)).success).toBe(true);
  });

  it("keeps the ids of complete rows when the line list grows", () => {
    const fullIds = new Set(rows.map((row) => row.id));
    for (let end = 1; end < lines.length; end += 1) {
      const prefix = mapActivities(lines.slice(0, end), { cwd: FIXTURE_CWD });
      const complete = prefix.slice(0, -1).filter((row) => !(row.kind === "tool" && row.status === "running"));
      for (const row of complete) expect(fullIds.has(row.id), `${name}@${end}: ${row.id}`).toBe(true);
    }
  });
});

describe("golden activity lists", () => {
  it.each(GOLDEN_FIXTURES)("%s", (name) => {
    const rows = mapActivities(parseFixture(name), { cwd: FIXTURE_CWD });
    const file = join(GOLDEN_DIR, `${name}.activities.json`);
    if (process.env["UPDATE_GOLDEN"] === "1") writeFileSync(file, `${JSON.stringify(rows, null, 2)}\n`);
    expect(rows).toEqual(JSON.parse(readFileSync(file, "utf8")));
  });
});
