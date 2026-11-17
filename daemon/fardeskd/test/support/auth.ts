// Login helpers for the auth tests. Hashes are made once with the real scrypt code.
import { hashPassword } from "../../src/auth/password.js";
import { loginResultSchema } from "../../src/contract/schema.js";
import type { LoginResult } from "../../src/contract/schema.js";
import type { TestDaemon } from "./daemon.js";

export const TEST_PASSWORD = "correct horse battery staple";
export const OTHER_PASSWORD = "a completely different one";

let cachedHash: Promise<string> | null = null;

export async function testPasswordHash(): Promise<string> {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return cachedHash;
}

export async function authOverrides(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return { auth: { passwordHash: await testPasswordHash(), ...extra } };
}

export async function loginAs(daemon: TestDaemon, deviceName: string, password = TEST_PASSWORD): Promise<LoginResult> {
  const response = await daemon.call("POST", "/v1/auth/login", { password, deviceName }, null);
  if (response.status !== 200) throw new Error(`login failed with ${response.status}`);
  return loginResultSchema.parse(response.json);
}
