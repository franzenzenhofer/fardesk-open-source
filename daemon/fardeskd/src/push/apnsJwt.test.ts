import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createApnsTokenSource, TOKEN_REFRESH_MS } from "./apnsJwt.js";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const keyPem = privateKey.export({ type: "pkcs8", format: "pem" });

function decode(part: string): unknown {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("apns token source", () => {
  it("creates a verifiable ES256 JWT with kid and iss/iat", () => {
    const nowMs = 1_800_000_000_000;
    const source = createApnsTokenSource({ keyPem, keyId: "KEY123", teamId: "TEAM456", now: () => nowMs });
    const [header, claims, signature] = source.token().split(".") as [string, string, string];
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(decode(claims)).toEqual({ iss: "TEAM456", iat: nowMs / 1000 });
    const ok = verify(
      "sha256",
      Buffer.from(`${header}.${claims}`),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
    expect(ok).toBe(true);
    expect(Buffer.from(signature, "base64url")).toHaveLength(64);
  });

  it("caches the token and refreshes it after 50 minutes", () => {
    let nowMs = 1_800_000_000_000;
    const source = createApnsTokenSource({ keyPem, keyId: "K", teamId: "T", now: () => nowMs });
    const first = source.token();
    nowMs += TOKEN_REFRESH_MS - 1;
    expect(source.token()).toBe(first);
    nowMs += 1;
    const second = source.token();
    expect(second).not.toBe(first);
    expect(source.token()).toBe(second);
  });
});
