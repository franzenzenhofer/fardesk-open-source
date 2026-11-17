import { sign } from "node:crypto";

const MS_PER_MINUTE = 60_000;
const MS_PER_SECOND = 1_000;
const REFRESH_MINUTES = 50;

export const TOKEN_REFRESH_MS = REFRESH_MINUTES * MS_PER_MINUTE;

export type ApnsTokenSourceOptions = {
  keyPem: string;
  keyId: string;
  teamId: string;
  now: () => number;
};

export type ApnsTokenSource = { token(): string };

function encode(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createApnsTokenSource(options: ApnsTokenSourceOptions): ApnsTokenSource {
  const header = encode({ alg: "ES256", kid: options.keyId });
  let cached: { jwt: string; issuedMs: number } | undefined;

  const issue = (issuedMs: number): string => {
    const claims = encode({ iss: options.teamId, iat: Math.floor(issuedMs / MS_PER_SECOND) });
    const data = `${header}.${claims}`;
    const signature = sign("sha256", Buffer.from(data), { key: options.keyPem, dsaEncoding: "ieee-p1363" });
    return `${data}.${signature.toString("base64url")}`;
  };

  return {
    token(): string {
      const nowMs = options.now();
      if (cached === undefined || nowMs - cached.issuedMs >= TOKEN_REFRESH_MS) {
        cached = { jwt: issue(nowMs), issuedMs: nowMs };
      }
      return cached.jwt;
    },
  };
}
