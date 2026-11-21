import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { errorResponseSchema, loginResultSchema, pairCodeResultSchema } from "../contract/schema.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

async function deviceToken(): Promise<string> {
  const code = pairCodeResultSchema.parse((await daemon.call("POST", "/v1/auth/pair-code", undefined, TEST_TOKEN)).json).code;
  return loginResultSchema.parse((await daemon.call("POST", "/v1/auth/pair", { code, deviceName: "Test iPhone" }, null)).json).token;
}

describe("POST /v1/homes/reload", () => {
  it("is refused for a paired device token and for no token, and answers the master token", async () => {
    daemon = await startTestDaemon();
    const device = await deviceToken();
    const refused = await daemon.call("POST", "/v1/homes/reload", undefined, device);
    expect(refused.status).toBe(401);
    expect(errorResponseSchema.parse(refused.json).error.code).toBe("unauthorized");
    expect((await daemon.call("POST", "/v1/homes/reload", undefined, null)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/machine", undefined, device)).status).toBe(200);
    const reloaded = await daemon.call("POST", "/v1/homes/reload", undefined, TEST_TOKEN);
    expect(reloaded.status).toBe(200);
    expect(reloaded.json).toEqual({ homes: [daemon.home.dir] });
  });
});
