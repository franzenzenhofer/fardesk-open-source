import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createPauseStore } from "./pauseStore.js";

describe("pause store", () => {
  it("pauses, persists across a new instance, expires and resumes", () => {
    const path = join(makeTempDir(), "notification-pause.json");
    let now = new Date("2026-11-16T09:00:00.000Z");
    const store = createPauseStore(path, () => now);
    expect(store.pausedUntil()).toBeNull();
    expect(store.pause(60)).toBe("2026-11-16T10:00:00.000Z");
    expect(createPauseStore(path, () => now).isPaused()).toBe(true);
    now = new Date("2026-11-16T10:00:01.000Z");
    expect(createPauseStore(path, () => now).pausedUntil()).toBeNull();
    now = new Date("2026-11-16T09:00:00.000Z");
    expect(store.pause(0)).toBeNull();
    expect(createPauseStore(path, () => now).isPaused()).toBe(false);
  });
});
