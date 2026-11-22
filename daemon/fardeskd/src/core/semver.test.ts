import { describe, expect, it } from "vitest";
import { FardeskError } from "./errors.js";
import { compareVersions, isOlder } from "./semver.js";

describe("compareVersions", () => {
  it("orders numbers, not text", () => {
    expect(compareVersions("4.10.0", "4.9.9")).toBe(1);
    expect(compareVersions("4.2.0", "4.2.1")).toBe(-1);
    expect(compareVersions("5.0.0", "4.99.99")).toBe(1);
    expect(compareVersions("4.2.0", "4.2.0")).toBe(0);
  });

  it("puts a pre-release before its release and orders pre-releases", () => {
    expect(compareVersions("4.3.0-beta.1", "4.3.0")).toBe(-1);
    expect(compareVersions("4.3.0", "4.3.0-beta.1")).toBe(1);
    expect(compareVersions("4.3.0-beta.2", "4.3.0-beta.10")).toBe(-1);
    expect(compareVersions("4.3.0-beta", "4.3.0-beta.1")).toBe(-1);
    expect(compareVersions("4.3.0-1", "4.3.0-beta")).toBe(-1);
    expect(compareVersions("4.3.0-rc", "4.3.0-beta")).toBe(1);
    expect(compareVersions("4.3.0-rc", "4.3.0-rc")).toBe(0);
  });

  it("ignores build metadata", () => {
    expect(compareVersions("4.2.0+abc", "4.2.0")).toBe(0);
  });

  it("refuses text that is no version", () => {
    expect(() => compareVersions("4.2", "4.2.0")).toThrow(FardeskError);
    expect(() => compareVersions("latest", "4.2.0")).toThrow(/not a version number/);
  });

  it("isOlder is true only for a strictly older version", () => {
    expect(isOlder("4.2.0", "4.3.0")).toBe(true);
    expect(isOlder("4.3.0", "4.3.0")).toBe(false);
    expect(isOlder("4.4.0", "4.3.0")).toBe(false);
  });
});
