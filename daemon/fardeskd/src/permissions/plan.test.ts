import { describe, expect, it } from "vitest";
import { activitySchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { setupBroker } from "../../test/support/brokerSetup.js";
import { EXIT_PLAN_MODE, PLAN_TITLE, SUMMARY_MAX_LENGTH, describeRequest } from "./describe.js";
import { REVISE_PREFIX, toHookOutput, toSdkResult } from "./hookReply.js";
import { permissionKey } from "./terminalKeys.js";

const PLAN = "# Create notes\n\n1. Write `notes.txt` containing hi.\n2. Verify the file.";
const LONG_PLAN = `# Long plan\n${"A line of the plan that must survive whole.\n".repeat(120)}`;
const planInput = { plan: PLAN };
const planRequest = { toolName: EXIT_PLAN_MODE, toolInput: planInput, suggestions: undefined };

const hook = (decision: Record<string, unknown>): Record<string, unknown> => ({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
});
const setMode = (mode: string): Record<string, unknown> => ({ type: "setMode", mode, destination: "session" });

function planAsk(plan: string = PLAN, allowBypass = true): ReturnType<typeof setupBroker> & { requestId: string } {
  const rig = setupBroker(60_000, allowBypass);
  const { requestId } = rig.broker.ask({ sessionId: "s1", toolName: EXIT_PLAN_MODE, toolInput: { plan }, cwd: "/work" });
  return { ...rig, requestId };
}

describe("describing ExitPlanMode", () => {
  it("keeps the whole plan and shows its first line as the summary", () => {
    expect(describeRequest(EXIT_PLAN_MODE, planInput)).toEqual({
      kind: "permission",
      title: PLAN_TITLE,
      summary: "Create notes",
      destructive: false,
      plan: PLAN,
    });
  });

  it("does not cut a 5,000 character plan", () => {
    const plan = `# Big\n${"x".repeat(5000)}`;
    const described = describeRequest(EXIT_PLAN_MODE, { plan });
    if (described.kind !== "permission") throw new Error("expected permission");
    expect(described.plan).toBe(plan);
    expect(described.plan).toHaveLength(5006);
    expect(described.summary).toBe("Big");
    const oneLine = describeRequest(EXIT_PLAN_MODE, { plan: "y".repeat(5000) });
    if (oneLine.kind !== "permission") throw new Error("expected permission");
    expect(oneLine.plan).toHaveLength(5000);
    expect(oneLine.summary).toHaveLength(SUMMARY_MAX_LENGTH + 3);
  });

  it("is a generic permission when the input holds no plan text", () => {
    expect(describeRequest(EXIT_PLAN_MODE, {})).toMatchObject({ title: "Allow ExitPlanMode?" });
    expect(describeRequest(EXIT_PLAN_MODE, { plan: "  " })).not.toHaveProperty("plan");
  });
});

describe("the plan request in the broker", () => {
  it("carries the whole plan and the decisions it takes", () => {
    const { broker, requestId } = planAsk(LONG_PLAN);
    const activity = activitySchema.parse(broker.activities("s1")[0]);
    expect(activity).toMatchObject({ kind: "permission", requestId, title: PLAN_TITLE, plan: LONG_PLAN, planChoices: ["approve_bypass", "approve_manual", "revise"], state: "pending" });
  });

  it("leaves out approve_bypass where bypass is not allowed on the machine", () => {
    const { broker } = planAsk(PLAN, false);
    expect(broker.activities("s1")[0]).toMatchObject({ planChoices: ["approve_manual", "revise"] });
  });

  it("answers approve_manual, approve_bypass and revise, and records the activity state", () => {
    for (const [choice, state] of [["approve_manual", "allowed"], ["approve_bypass", "allowed"], ["revise", "denied"]] as const) {
      const { broker, requestId } = planAsk();
      broker.decide("s1", requestId, choice, "add tests");
      expect(broker.activities("s1")[0]).toMatchObject({ state });
    }
  });

  it("refuses revise without a message, bypass when not allowed, and keeps the request pending", () => {
    const { broker, requestId } = planAsk(PLAN, false);
    expect(() => { broker.decide("s1", requestId, "revise"); }).toThrow(/needs a message/);
    expect(() => { broker.decide("s1", requestId, "approve_bypass"); }).toThrow(/not possible for this plan request/);
    expect(broker.activities("s1")[0]).toMatchObject({ state: "pending" });
  });

  it("refuses a plan decision on a request that is not a plan", () => {
    const { broker } = setupBroker(60_000);
    const { requestId } = broker.ask({ sessionId: "s1", toolName: "Bash", toolInput: { command: "ls" }, cwd: "/work" });
    for (const choice of ["approve_bypass", "approve_manual", "revise"] as const) {
      try {
        broker.decide("s1", requestId, choice, "x");
        throw new Error("expected a refusal");
      } catch (error) {
        expect(error).toBeInstanceOf(FardeskError);
        expect((error as FardeskError).code).toBe("invalid_request");
      }
    }
  });

  it("still takes allow and deny on a plan request, for older apps", () => {
    const first = planAsk();
    first.broker.decide("s1", first.requestId, "allow");
    expect(first.broker.activities("s1")[0]).toMatchObject({ state: "allowed" });
    const second = planAsk();
    second.broker.decide("s1", second.requestId, "deny");
    expect(second.broker.activities("s1")[0]).toMatchObject({ state: "denied" });
  });
});

describe("what the answers become", () => {
  it("hook reply: approve_bypass switches the session to bypassPermissions", () => {
    expect(toHookOutput({ state: "planned", choice: "approve_bypass" }, planRequest)).toEqual(
      hook({ behavior: "allow", updatedPermissions: [setMode("bypassPermissions")] }),
    );
  });

  it("hook reply: approve_manual switches the session to default mode", () => {
    expect(toHookOutput({ state: "planned", choice: "approve_manual" }, planRequest)).toEqual(
      hook({ behavior: "allow", updatedPermissions: [setMode("default")] }),
    );
  });

  it("hook reply: revise denies with the user's words", () => {
    expect(toHookOutput({ state: "planned", choice: "revise", message: "add a line saying bye" }, planRequest)).toEqual(
      hook({ behavior: "deny", message: `${REVISE_PREFIX}add a line saying bye` }),
    );
  });

  it("SDK result: the same three, with the original input", () => {
    expect(toSdkResult({ state: "planned", choice: "approve_bypass" }, planRequest)).toEqual({
      behavior: "allow",
      updatedInput: planInput,
      updatedPermissions: [setMode("bypassPermissions")],
    });
    expect(toSdkResult({ state: "planned", choice: "approve_manual" }, planRequest)).toEqual({
      behavior: "allow",
      updatedInput: planInput,
      updatedPermissions: [setMode("default")],
    });
    expect(toSdkResult({ state: "planned", choice: "revise", message: "shorter" }, planRequest)).toEqual({
      behavior: "deny",
      message: `${REVISE_PREFIX}shorter`,
    });
  });

  it("is never typed into a terminal dialog", () => {
    for (const choice of ["approve_bypass", "approve_manual", "revise"] as const) {
      expect(() => permissionKey(choice)).toThrow(/answer it at the computer/);
    }
  });
});
