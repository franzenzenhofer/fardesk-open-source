import { describe, expect, it } from "vitest";
import { requireHome } from "./core.js";

describe("requireHome", () => {
  it("returns the home of a session and refuses one that lives in no configured home", () => {
    expect(requireHome("s1", "/Users/dev/.claude")).toBe("/Users/dev/.claude");
    expect(() => requireHome("s1", null)).toThrow(/no configured Claude home/);
  });
});
