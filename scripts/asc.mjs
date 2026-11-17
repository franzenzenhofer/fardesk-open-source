#!/usr/bin/env node
// Minimal App Store Connect API caller.
// Usage: ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_KEY_PATH=... node scripts/asc.mjs METHOD /v1/path [body.json]
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const ASC_HOST = "https://api.appstoreconnect.apple.com";
const TOKEN_LIFETIME_SECONDS = 600;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function makeToken() {
  const header = { alg: "ES256", kid: requireEnv("ASC_KEY_ID"), typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: requireEnv("ASC_ISSUER_ID"),
    iat: now,
    exp: now + TOKEN_LIFETIME_SECONDS,
    aud: "appstoreconnect-v1",
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(readFileSync(requireEnv("ASC_KEY_PATH")));
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}

const [method, path, bodyFile] = process.argv.slice(2);
if (!method || !path) throw new Error("Usage: asc.mjs METHOD /v1/path [body.json]");

const response = await fetch(`${ASC_HOST}${path}`, {
  method,
  headers: { Authorization: `Bearer ${makeToken()}`, "Content-Type": "application/json" },
  body: bodyFile ? readFileSync(bodyFile, "utf8") : undefined,
});
const text = await response.text();
process.stdout.write(`${text}\n`);
if (!response.ok) {
  process.stderr.write(`HTTP ${response.status}\n`);
  process.exit(1);
}
