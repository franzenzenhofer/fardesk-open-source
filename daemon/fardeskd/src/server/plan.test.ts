import { afterEach, describe, expect, it } from "vitest";
import { hookSocket, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID, hookFixtureText, pendingRequestId, seedHookSession } from "../../test/support/hookSession.js";
import { runHook } from "../../test/support/hookRun.js";
import type { HookRun } from "../../test/support/hookRun.js";
import { buildHookCommand } from "../hooks/command.js";
import { activityPageSchema } from "../contract/schema.js";
import { REVISE_PREFIX } from "../permissions/hookReply.js";

const PLAN = `# Create notes\n\n1. Write notes.txt containing hi.\n2. Check it.\n${"Detail line that must arrive whole.\n".repeat(150)}`;
const permissionPath = (requestId: string): string => `/v1/sessions/${HOOK_SESSION_ID}/permission/${requestId}`;
const BYPASS_ON = { owned: { allowBypass: true } };

let daemon: TestDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

async function boot(configOverrides: Record<string, unknown>): Promise<TestDaemon> {
  daemon = await startTestDaemon(configOverrides);
  await seedHookSession(daemon);
  return daemon;
}

function fire(running: TestDaemon, tool: string, toolInput: unknown): Promise<HookRun> {
  const base = JSON.parse(hookFixtureText("PermissionRequest-bash.json")) as Record<string, unknown>;
  const payload = JSON.stringify({ ...base, tool_name: tool, tool_input: toolInput, permission_mode: tool === "ExitPlanMode" ? "plan" : "default" });
  return runHook(buildHookCommand(hookSocket(running), 20), payload);
}

function verdict(run: HookRun): Record<string, unknown> {
  const output = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; decision: Record<string, unknown> } };
  expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  return output.hookSpecificOutput.decision;
}

async function answerPlan(running: TestDaemon, body: unknown): Promise<{ status: number; run: Promise<HookRun>; requestId: string }> {
  const run = fire(running, "ExitPlanMode", { plan: PLAN });
  const requestId = await pendingRequestId(running, "permission");
  const response = await running.call("POST", permissionPath(requestId), body);
  return { status: response.status, run, requestId };
}

describe("plan approval through the real hook command", () => {
  it("lists the plan whole with its choices, over HTTP", async () => {
    const running = await boot(BYPASS_ON);
    const run = fire(running, "ExitPlanMode", { plan: PLAN });
    const requestId = await pendingRequestId(running, "permission");
    const page = activityPageSchema.parse((await running.call("GET", `/v1/sessions/${HOOK_SESSION_ID}/activity`)).json);
    const item = page.items.find((entry) => entry.kind === "permission" && entry.requestId === requestId);
    expect(item).toMatchObject({ title: "Ready to code?", summary: "Create notes", plan: PLAN, planChoices: ["approve_bypass", "approve_manual", "revise"], state: "pending" });
    await running.call("POST", permissionPath(requestId), { decision: "deny" });
    expect(verdict(await run)).toMatchObject({ behavior: "deny" });
  });

  it("approve_bypass: allow and switch the session to bypassPermissions", async () => {
    const answered = await answerPlan(await boot(BYPASS_ON), { decision: "approve_bypass" });
    expect(answered.status).toBe(200);
    expect(verdict(await answered.run)).toEqual({ behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "bypassPermissions", destination: "session" }] });
  });

  it("approve_manual: allow and switch the session to default mode", async () => {
    const answered = await answerPlan(await boot({}), { decision: "approve_manual" });
    expect(answered.status).toBe(200);
    expect(verdict(await answered.run)).toEqual({ behavior: "allow", updatedPermissions: [{ type: "setMode", mode: "default", destination: "session" }] });
  });

  it("revise: deny with the user's words", async () => {
    const answered = await answerPlan(await boot({}), { decision: "revise", message: "add a line saying bye" });
    expect(answered.status).toBe(200);
    expect(verdict(await answered.run)).toEqual({ behavior: "deny", message: `${REVISE_PREFIX}add a line saying bye` });
  });

  it("answers 400 for revise without a message and for bypass where it is off, and keeps the request open", async () => {
    const running = await boot({});
    const run = fire(running, "ExitPlanMode", { plan: PLAN });
    const requestId = await pendingRequestId(running, "permission");
    expect((await running.call("POST", permissionPath(requestId), { decision: "revise" })).status).toBe(400);
    expect((await running.call("POST", permissionPath(requestId), { decision: "revise", message: "" })).status).toBe(400);
    expect((await running.call("POST", permissionPath(requestId), { decision: "approve_bypass" })).status).toBe(400);
    expect((await running.call("POST", permissionPath(requestId), { decision: "approve_manual" })).status).toBe(200);
    expect(verdict(await run)).toMatchObject({ behavior: "allow" });
  });

  it("answers 400 for a plan decision on a Bash request", async () => {
    const running = await boot(BYPASS_ON);
    const run = fire(running, "Bash", { command: "touch a1.txt" });
    const requestId = await pendingRequestId(running, "permission");
    await waitUntil(() => running.services.activity(HOOK_SESSION_ID, {}).items.some((item) => item.kind === "permission" && item.state === "pending"));
    for (const body of [{ decision: "approve_bypass" }, { decision: "approve_manual" }, { decision: "revise", message: "x" }]) {
      expect((await running.call("POST", permissionPath(requestId), body)).status).toBe(400);
    }
    await running.call("POST", permissionPath(requestId), { decision: "allow" });
    expect(verdict(await run)).toEqual({ behavior: "allow" });
  });

  it("ignores an unknown extra field in the decision body", async () => {
    const answered = await answerPlan(await boot({}), { decision: "approve_manual", futureField: 1 });
    expect(answered.status).toBe(200);
    await answered.run;
  });
});
