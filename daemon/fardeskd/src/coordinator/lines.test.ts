import { describe, expect, it } from "vitest";
import { activityFixtures } from "../contract/fixturesActivity.js";
import { activitySchema } from "../contract/schema.js";
import { activityLine, LINE_MAX_CHARS } from "./lines.js";

describe("activityLine", () => {
  const cases = Object.entries(activityFixtures).map(([name, fixture]) => [name, activitySchema.parse(fixture)] as const);

  it.each(cases)("turns the %s fixture into one short line that names its kind", (_name, activity) => {
    const line = activityLine(activity);
    expect(line).toContain(`${activity.kind}: `);
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThanOrEqual(LINE_MAX_CHARS);
  });

  it("covers every activity kind", () => {
    expect(new Set(cases.map(([, activity]) => activity.kind))).toEqual(
      new Set(["user", "assistant", "tool", "files", "question", "dialog", "permission", "system"]),
    );
  });

  it("collapses whitespace and truncates a long text", () => {
    const line = activityLine({ id: "a", ts: "2026-11-15T10:00:00.000Z", kind: "assistant", text: `first\n\n${"word ".repeat(200)}` });
    expect(line.startsWith("2026-11-15T10:00:00.000Z assistant: first word")).toBe(true);
    expect(line.length).toBeGreaterThan(LINE_MAX_CHARS - 5);
    expect(line.length).toBeLessThanOrEqual(LINE_MAX_CHARS);
    expect(line.endsWith("...")).toBe(true);
  });
});
