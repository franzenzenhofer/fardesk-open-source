import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { sessionSummaryFixtures } from "../contract/fixturesSessions.js";
import { sessionSummarySchema } from "../contract/schema.js";
import { visibleSessions } from "./visible.js";
import type { ListRules } from "./visible.js";

const base = sessionSummarySchema.parse(sessionSummaryFixtures.working);
const ended = { ...base, status: "ended" as const, canStop: false, replyMode: "resume" as const };
const NOW = Date.parse("2026-11-16T12:00:00.000Z");
const daysAgo = (days: number): string => new Date(NOW - days * 86_400_000).toISOString();
const rules = (overrides: Partial<ListRules> = {}): ListRules => ({ now: NOW, endedWithinDays: 24, maxEnded: 30, hiddenRoots: [], ...overrides });
const ids = (sessions: { id: string }[]): string[] => sessions.map((session) => session.id);

describe("visibleSessions", () => {
  it("hides only ended sessions whose folder is gone (real folders on disk)", () => {
    const folder = makeTempDir();
    const sessions = [
      { ...ended, id: "kept-ended", cwd: folder, updatedAt: daysAgo(1) },
      { ...ended, id: "hidden-ended", cwd: `${folder}/deleted-test-folder`, updatedAt: daysAgo(1) },
      { ...base, id: "kept-working", cwd: `${folder}/deleted-test-folder` },
    ];
    expect(ids(visibleSessions(sessions, rules()))).toEqual(["kept-ended", "kept-working"]);
  });

  it("lists ended sessions of the last 24 days only, and at most maxEnded of them, newest first, live ones always", () => {
    const folder = makeTempDir();
    const sessions = [
      { ...base, id: "live-old", cwd: folder, updatedAt: daysAgo(90) },
      { ...ended, id: "too-old", cwd: folder, updatedAt: daysAgo(25) },
      { ...ended, id: "older", cwd: folder, updatedAt: daysAgo(3) },
      { ...ended, id: "newest", cwd: folder, updatedAt: daysAgo(1) },
      { ...ended, id: "middle", cwd: folder, updatedAt: daysAgo(2) },
    ];
    expect(ids(visibleSessions(sessions, rules({ maxEnded: 2 })))).toEqual(["live-old", "newest", "middle"]);
  });

  it("keeps a pinned ended session past the age window, the cap and a missing folder", () => {
    const folder = makeTempDir();
    const pinned = { name: null, color: null, pinned: true };
    const sessions = [
      { ...ended, id: "pinned-old", cwd: folder, updatedAt: daysAgo(90), label: pinned },
      { ...ended, id: "pinned-gone", cwd: `${folder}/deleted-test-folder`, updatedAt: daysAgo(40), label: pinned },
      { ...ended, id: "unpinned-old", cwd: folder, updatedAt: daysAgo(90) },
      { ...ended, id: "newest", cwd: folder, updatedAt: daysAgo(1) },
      { ...ended, id: "second", cwd: folder, updatedAt: daysAgo(2) },
    ];
    expect(ids(visibleSessions(sessions, rules({ maxEnded: 1 })))).toEqual(["pinned-old", "pinned-gone", "newest"]);
  });

  it("checks folders newest first and stops after maxEnded kept sessions", () => {
    const folder = makeTempDir();
    const sessions = Array.from({ length: 200 }, (_, index) => ({
      ...ended,
      id: `ended-${index}`,
      cwd: folder,
      updatedAt: new Date(NOW - (index + 1) * 60_000).toISOString(),
    }));
    let lookups = 0;
    const folderExists = (path: string): boolean => {
      lookups += 1;
      return path === folder;
    };
    const shown = visibleSessions(sessions, rules({ maxEnded: 30, folderExists }));
    expect(shown).toHaveLength(30);
    expect(lookups).toBe(30);
  });

  it("hides ended sessions under the hidden roots (temp dirs, the coordinator folder) but never live ones", () => {
    const root = makeTempDir();
    const hidden = join(root, "coordinator");
    const project = join(root, "coordinator-app");
    mkdirSync(hidden);
    mkdirSync(project);
    const sessions = [
      { ...ended, id: "old-coordinator", cwd: hidden, updatedAt: daysAgo(1) },
      { ...ended, id: "sibling-project", cwd: project, updatedAt: daysAgo(1) },
      { ...base, id: "live-coordinator", cwd: hidden },
    ];
    expect(ids(visibleSessions(sessions, rules({ hiddenRoots: [hidden] })))).toEqual(["sibling-project", "live-coordinator"]);
  });
});
