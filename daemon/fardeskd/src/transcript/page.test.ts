import { describe, expect, it } from "vitest";
import type { Activity } from "../contract/schema.js";
import { at } from "../../test/support/transcriptLines.js";
import { pageActivities } from "./page.js";

const all: Activity[] = Array.from({ length: 10 }, (_unused, index) => ({ kind: "user", id: `r${index}`, ts: at(index), text: `row ${index}` }));
const ids = (items: Activity[]): string[] => items.map((item) => item.id);

describe("pageActivities", () => {
  it("returns the newest rows oldest first and points at the oldest returned row", () => {
    const page = pageActivities(all, { limit: 3 });
    expect(ids(page.items)).toEqual(["r7", "r8", "r9"]);
    expect(page.nextBefore).toBe("r7");
  });

  it("pages backwards with before and ends with null", () => {
    const second = pageActivities(all, { before: "r7", limit: 3 });
    expect(ids(second.items)).toEqual(["r4", "r5", "r6"]);
    expect(second.nextBefore).toBe("r4");
    const third = pageActivities(all, { before: "r4", limit: 3 });
    expect(ids(third.items)).toEqual(["r1", "r2", "r3"]);
    const last = pageActivities(all, { before: "r1", limit: 3 });
    expect(ids(last.items)).toEqual(["r0"]);
    expect(last.nextBefore).toBeNull();
  });

  it("has no next page when everything fits or the page ends exactly at the start", () => {
    expect(pageActivities(all, { limit: 10 })).toMatchObject({ nextBefore: null });
    expect(pageActivities(all, { limit: 50 }).items).toHaveLength(10);
    expect(pageActivities(all, { before: "r3", limit: 3 })).toMatchObject({ nextBefore: null });
    expect(pageActivities(all, { before: "r0", limit: 3 })).toEqual({ items: [], nextBefore: null });
    expect(pageActivities([], { limit: 3 })).toEqual({ items: [], nextBefore: null });
  });

  it("walks the whole list page by page without gaps or repeats", () => {
    const seen: string[] = [];
    let before: string | undefined;
    for (;;) {
      const page = pageActivities(all, before === undefined ? { limit: 4 } : { before, limit: 4 });
      seen.unshift(...ids(page.items));
      if (page.nextBefore === null) break;
      before = page.nextBefore;
    }
    expect(seen).toEqual(ids(all));
  });

  it("rejects an unknown before id and a bad limit with invalid_request", () => {
    expect(() => pageActivities(all, { before: "nope", limit: 3 })).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => pageActivities(all, { limit: 0 })).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(() => pageActivities(all, { limit: 1.5 })).toThrow(expect.objectContaining({ code: "invalid_request" }));
  });
});
