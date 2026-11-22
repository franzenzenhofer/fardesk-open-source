// Pairing helper for the auth tests: a device gets its token the one way there is, a one-time code.
import { loginResultSchema, pairCodeResultSchema } from "../../src/contract/schema.js";
import type { LoginResult } from "../../src/contract/schema.js";
import type { TestDaemon } from "./daemon.js";

/** Mints a one-time code with the master token and exchanges it for a device token of its own. */
export async function pairAs(daemon: TestDaemon, deviceName: string): Promise<LoginResult> {
  const minted = await daemon.call("POST", "/v1/auth/pair-code");
  if (minted.status !== 200) throw new Error(`minting a pairing code failed with ${minted.status}`);
  const { code } = pairCodeResultSchema.parse(minted.json);
  const response = await daemon.call("POST", "/v1/auth/pair", { code, deviceName }, null);
  if (response.status !== 200) throw new Error(`pairing failed with ${response.status}`);
  return loginResultSchema.parse(response.json);
}
