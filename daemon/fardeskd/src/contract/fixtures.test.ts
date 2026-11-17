import { describe, expect, it } from "vitest";
import { contractFixtures } from "./fixtures.js";
import { contractNames, formatJson } from "./jsonSchema.js";
import { contractSchemas } from "./schema.js";

const FAKE_TOKEN_PATTERN = /^[0-9a-f]{64,128}$/;

describe("golden fixtures", () => {
  it("has at least one case for every contract name and none extra", () => {
    expect(Object.keys(contractFixtures).sort()).toEqual([...contractNames()].sort());
    for (const name of contractNames()) {
      expect(Object.keys(contractFixtures[name]).length).toBeGreaterThan(0);
    }
  });

  for (const name of contractNames()) {
    for (const [caseName, value] of Object.entries(contractFixtures[name])) {
      it(`${name}/${caseName} parses strictly and round-trips unchanged`, () => {
        const parsed = contractSchemas[name].parse(value);
        expect(parsed).toEqual(value);
        expect(JSON.parse(formatJson(parsed))).toEqual(JSON.parse(formatJson(value)));
      });
    }
  }

  it("uses plain hyphens only and no real-looking secrets", () => {
    const text = JSON.stringify(contractFixtures);
    expect(text).not.toMatch(/[–—]/);
    const longHex = text.match(/[0-9a-f]{64,}/g) ?? [];
    expect(longHex.length).toBeGreaterThan(0);
    for (const token of longHex) expect(token).toMatch(FAKE_TOKEN_PATTERN);
  });
});
