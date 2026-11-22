import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitUntil } from "../../test/support/env.js";
import { TEST_MODEL, useOwnedEnv, waitForIdle } from "../../test/support/owned.js";
import type { PendingRequest } from "../../test/support/owned.js";

// Real claude (haiku) in plan mode: the plan arrives whole on the phone, a revision comes back as a new plan, an approval leaves plan mode.
const TEST_TIMEOUT_MS = 300_000;
const WAIT_MS = 120_000;
const PROMPT = "Make a two-line plan to create notes.txt containing hi, then call ExitPlanMode.";
const REVISION = "add a line saying bye";

const env = useOwnedEnv();

const isPlan = (request: PendingRequest): boolean => request.activity.kind === "permission" && request.activity.tool === "ExitPlanMode";
const planText = (request: PendingRequest): string => (request.activity.kind === "permission" ? (request.activity.plan ?? "") : "");

/** Waits for the n-th plan request (1-based) of this test and returns it. */
async function nthPlan(n: number): Promise<PendingRequest> {
  await waitUntil(() => env().pending.filter(isPlan).length >= n, WAIT_MS);
  const found = env().pending.filter(isPlan)[n - 1];
  if (found === undefined) throw new Error("unreachable");
  return found;
}

describe("plan approval (real claude, haiku)", () => {
  it("shows the plan, takes a revision, then approves and leaves plan mode", async () => {
    const id = await env().runner.start({ cwd: env().cwd, prompt: PROMPT, worktree: false, model: TEST_MODEL, permissionMode: "plan" });

    const first = await nthPlan(1);
    expect(first.sessionId).toBe(id);
    expect(first.activity).toMatchObject({ kind: "permission", title: "Ready to code?", planChoices: ["approve_bypass", "approve_manual", "revise"] });
    expect(planText(first).trim()).not.toBe("");
    env().broker.decide(id, first.requestId, "revise", REVISION);

    const second = await nthPlan(2);
    expect(second.requestId).not.toBe(first.requestId);
    expect(planText(second).toLowerCase()).toContain("bye");
    env().broker.decide(id, second.requestId, "approve_manual");

    // Out of plan mode in default mode, Claude's file write asks for permission instead of being refused.
    await waitUntil(() => env().pending.some((request) => !isPlan(request) && request.activity.kind === "permission" && request.activity.tool !== "ExitPlanMode"), WAIT_MS);
    const write = env().pending.find((request) => !isPlan(request) && request.activity.kind === "permission");
    if (write === undefined) throw new Error("unreachable");
    env().broker.decide(id, write.requestId, "allow");
    await waitUntil(() => existsSync(join(env().cwd, "notes.txt")), WAIT_MS);
    await waitForIdle(env(), id);
  }, TEST_TIMEOUT_MS);
});
