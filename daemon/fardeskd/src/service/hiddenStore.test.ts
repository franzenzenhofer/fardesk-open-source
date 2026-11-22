import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createHiddenStore } from "./hiddenStore.js";

describe("hidden store", () => {
  it("persists the hidden ids sorted across instances and writes only on a change", () => {
    const path = join(makeTempDir(), "state", "hidden-sessions.json");
    const first = createHiddenStore(path);
    expect(first.isHidden("a")).toBe(false);
    first.set("b", true);
    first.set("a", true);
    first.set("a", true);
    first.set("c", false);
    expect([...first.ids()]).toEqual(["b", "a"]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hidden: ["a", "b"] });
    first.set("a", false);
    const second = createHiddenStore(path);
    expect(second.isHidden("b")).toBe(true);
    expect(second.isHidden("a")).toBe(false);
  });

  it("fails loud on a corrupt file", () => {
    const path = join(makeTempDir(), "hidden-sessions.json");
    writeFileSync(path, JSON.stringify({ hidden: "a" }));
    expect(() => createHiddenStore(path)).toThrow(/hidden sessions store .* is corrupt/);
  });
});
