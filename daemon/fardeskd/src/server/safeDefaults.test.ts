import { afterEach, describe, expect, it } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir } from "../../test/support/env.js";
import { machineSchema } from "../contract/schema.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

const newSession = { cwd: "", prompt: "hi", worktree: false, model: null };

describe("bypass permissions default", () => {
  it("answers 501 naming owned.allowBypass when a request asks for bypassPermissions", async () => {
    daemon = await startTestDaemon();
    const message = await expectApiError(daemon, "POST", "/v1/sessions/new", 501, "unsupported", { ...newSession, cwd: makeTempDir(), permissionMode: "bypassPermissions" });
    expect(message).toContain("owned.allowBypass");
  });

  it("reports both switches on the machine so the app can hide what is off", async () => {
    daemon = await startTestDaemon();
    expect(machineSchema.parse((await daemon.call("GET", "/v1/machine")).json)).toMatchObject({ allowBypass: false, coordinatorEnabled: false });
    await daemon.close();
    daemon = await startTestDaemon({ owned: { allowBypass: true }, coordinator: { enabled: true } });
    expect(machineSchema.parse((await daemon.call("GET", "/v1/machine")).json)).toMatchObject({ allowBypass: true, coordinatorEnabled: true });
  });
});

describe("coordinator off by default", () => {
  it("answers 501 naming coordinator.enabled and starts no session", async () => {
    daemon = await startTestDaemon();
    const message = await expectApiError(daemon, "POST", "/v1/coordinator", 501, "unsupported", { prompt: "list my sessions" });
    expect(message).toContain("coordinator.enabled");
    expect((await daemon.call("GET", "/v1/coordinator")).json).toEqual({ sessionId: null });
    expect(daemon.services.sessions()).toEqual([]);
  });
});
