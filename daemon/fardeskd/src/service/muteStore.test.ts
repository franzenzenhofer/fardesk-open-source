import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createMuteStore } from "./muteStore.js";

describe("mute store", () => {
  it("persists mutes across instances", () => {
    const path = join(makeTempDir(), "state", "mutes.json");
    const first = createMuteStore(path);
    expect(first.isMuted("a")).toBe(false);
    first.set("b", true);
    first.set("a", true);
    first.set("a", false);
    expect(first.isMuted("b")).toBe(true);
    expect(first.isMuted("a")).toBe(false);
    expect(createMuteStore(path).isMuted("b")).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ muted: ["b"] });
  });
});
