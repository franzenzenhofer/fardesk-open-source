import { describe, expect, it } from "vitest";
import { createPairCodes, PAIR_CODE_TTL_MS } from "./pairCodes.js";

describe("pair codes", () => {
  it("issues a 43 character base64url code that is not a 64-hex string", () => {
    const { code } = createPairCodes(() => 0).issue();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("works once and fails the second time", () => {
    const codes = createPairCodes(() => 0);
    const { code } = codes.issue();
    expect(codes.redeem(code)).toBe(true);
    expect(codes.redeem(code)).toBe(false);
  });

  it("is valid for 10 minutes and fails after", () => {
    let now = 1_000;
    const codes = createPairCodes(() => now);
    const { code, expiresAt } = codes.issue();
    expect(expiresAt).toBe(new Date(1_000 + PAIR_CODE_TTL_MS).toISOString());
    now += PAIR_CODE_TTL_MS - 1;
    expect(codes.redeem(code)).toBe(true);
    const late = codes.issue();
    now += PAIR_CODE_TTL_MS;
    expect(codes.redeem(late.code)).toBe(false);
  });

  it("rejects codes it never issued", () => {
    expect(createPairCodes(() => 0).redeem("x".repeat(43))).toBe(false);
  });
});
