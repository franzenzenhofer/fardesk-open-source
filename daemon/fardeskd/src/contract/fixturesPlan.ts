import type { FixtureCases } from "./fixtureTypes.js";

const PLAN = [
  "# Soften the brush smear",
  "",
  "1. Lower the falloff exponent in `PaintEngine.swift` from 2.0 to 1.4.",
  "2. Add a regression test that compares three sample strokes.",
  "3. Run `swift test` and update the screenshots.",
].join("\n");

const PLAN_BASE = {
  kind: "permission",
  tool: "ExitPlanMode",
  title: "Ready to code?",
  summary: "Soften the brush smear",
  plan: PLAN,
  cwd: "/Users/dev/smear-studio",
  destructive: false,
} as const;

/** A plan request: the whole plan in `plan`, the valid decisions in `planChoices` (no approve_bypass where the machine forbids bypass). */
export const planActivityFixtures: FixtureCases<"Activity"> = {
  planPending: {
    ...PLAN_BASE,
    id: "req-req_p1",
    ts: "2026-11-22T10:00:00.000Z",
    requestId: "req_p1",
    state: "pending",
    planChoices: ["approve_bypass", "approve_manual", "revise"],
  },
  planPendingNoBypass: {
    ...PLAN_BASE,
    id: "req-req_p2",
    ts: "2026-11-22T10:05:00.000Z",
    requestId: "req_p2",
    state: "pending",
    planChoices: ["approve_manual", "revise"],
  },
  planApproved: {
    ...PLAN_BASE,
    id: "req-req_p3",
    ts: "2026-11-22T10:10:00.000Z",
    requestId: "req_p3",
    state: "allowed",
    planChoices: ["approve_bypass", "approve_manual", "revise"],
  },
  planRevised: {
    ...PLAN_BASE,
    id: "req-req_p4",
    ts: "2026-11-22T10:15:00.000Z",
    requestId: "req_p4",
    state: "denied",
    planChoices: ["approve_bypass", "approve_manual", "revise"],
  },
};
