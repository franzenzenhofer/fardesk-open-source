import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOwned } from "../../test/support/fakeOwned.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir, waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID } from "../../test/support/hookSession.js";
import { REVISE_PREFIX } from "../permissions/hookReply.js";

// An owned session whose (fake) claude asks before ExitPlanMode through the real SDK control protocol.
const FAKE_CLAUDE = fileURLToPath(new URL("../../test/support/fakeDialogClaude.mjs", import.meta.url));
const SESSION_ID = HOOK_SESSION_ID;
const CALL_ID = "tool-1";
const PLAN_INPUT = { plan: `# Create notes\n\n1. Write notes.txt containing hi.\n${"More detail.\n".repeat(100)}` };

let daemon: TestDaemon | null = null;
let logPath = "";

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  delete process.env["FAKE_TOOLS"];
  delete process.env["FAKE_DIALOG_LOG"];
  delete process.env["FAKE_SESSION_ID"];
});

async function boot(allowBypass: boolean): Promise<TestDaemon> {
  logPath = join(makeTempDir("fd-plan-"), "cli.jsonl");
  process.env["FAKE_TOOLS"] = JSON.stringify([{ id: CALL_ID, tool: "ExitPlanMode", input: PLAN_INPUT }]);
  process.env["FAKE_DIALOG_LOG"] = logPath;
  process.env["FAKE_SESSION_ID"] = SESSION_ID;
  daemon = await startFakeOwned({ claudeBinary: FAKE_CLAUDE, owned: { allowBypass } }, { prompt: "plan it", permissionMode: "plan" }, SESSION_ID);
  return daemon;
}

async function pendingPlan(running: TestDaemon): Promise<string> {
  let requestId = "";
  await waitUntil(() => {
    const found = running.services.activity(SESSION_ID, {}).items.find((item) => item.kind === "permission" && item.state === "pending");
    if (found?.kind === "permission") requestId = found.requestId;
    return requestId !== "";
  });
  return requestId;
}

/** What the fake CLI received as the SDK's answer to the can_use_tool request. */
async function cliAnswer(): Promise<Record<string, unknown>> {
  const read = (): Record<string, unknown> | undefined => {
    const lines = readFileSync(logPath, "utf8").split("\n").filter((line) => line !== "");
    const reply = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find((line) => line["type"] === "control_response" && (line["response"] as { request_id?: string }).request_id === CALL_ID);
    return reply === undefined ? undefined : (reply["response"] as { response: Record<string, unknown> }).response;
  };
  await waitUntil(() => read() !== undefined);
  return read() ?? {};
}

describe("plan approval in an owned session (fake claude, real SDK protocol)", () => {
  it("shows the whole plan and approve_bypass answers allow with setMode bypassPermissions", async () => {
    const running = await boot(true);
    const requestId = await pendingPlan(running);
    expect(running.services.activity(SESSION_ID, {}).items.find((item) => item.kind === "permission")).toMatchObject({
      title: "Ready to code?",
      plan: PLAN_INPUT.plan,
      planChoices: ["approve_bypass", "approve_manual", "revise"],
    });
    const response = await running.call("POST", `/v1/sessions/${SESSION_ID}/permission/${requestId}`, { decision: "approve_bypass" });
    expect(response.status).toBe(200);
    expect(await cliAnswer()).toMatchObject({
      behavior: "allow",
      updatedInput: PLAN_INPUT,
      updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }],
    });
  });

  it("approve_manual answers allow with setMode default", async () => {
    const running = await boot(false);
    const requestId = await pendingPlan(running);
    expect((await running.call("POST", `/v1/sessions/${SESSION_ID}/permission/${requestId}`, { decision: "approve_bypass" })).status).toBe(400);
    expect((await running.call("POST", `/v1/sessions/${SESSION_ID}/permission/${requestId}`, { decision: "approve_manual" })).status).toBe(200);
    expect(await cliAnswer()).toMatchObject({ behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "default", destination: "session" }] });
  });

  it("revise answers deny with the user's words", async () => {
    const running = await boot(false);
    const requestId = await pendingPlan(running);
    expect((await running.call("POST", `/v1/sessions/${SESSION_ID}/permission/${requestId}`, { decision: "revise" })).status).toBe(400);
    expect((await running.call("POST", `/v1/sessions/${SESSION_ID}/permission/${requestId}`, { decision: "revise", message: "add a line saying bye" })).status).toBe(200);
    expect(await cliAnswer()).toMatchObject({ behavior: "deny", message: `${REVISE_PREFIX}add a line saying bye` });
  });
});
