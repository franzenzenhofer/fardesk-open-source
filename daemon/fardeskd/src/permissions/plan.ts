// Plan approval: the answers to a plan request (tool ExitPlanMode), as in Claude Code's terminal prompt
// "Ready to code?". See "Plan approval" in public/docs/DAEMON.md.
import { planChoiceSchema } from "../contract/schema.js";
import type { PermissionDecision, PlanChoice } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";

const APPROVE_BYPASS: PlanChoice = "approve_bypass";
const REVISE = "revise";

export type PlanAnswer = { choice: Exclude<PlanChoice, "revise"> } | { choice: "revise"; message: string };

export function isPlanChoice(decision: PermissionDecision): decision is PlanChoice {
  return planChoiceSchema.safeParse(decision).success;
}

/** The decisions a plan request takes on this machine: bypass only where `owned.allowBypass` is on. */
export function planChoicesFor(allowBypass: boolean): PlanChoice[] {
  return planChoiceSchema.options.filter((choice) => choice !== APPROVE_BYPASS || allowBypass);
}

/** Throws invalid_request unless the request takes this plan decision (and, for revise, a message). */
export function checkPlanDecision(planChoices: readonly PlanChoice[] | undefined, choice: PlanChoice, message: string | undefined): PlanAnswer {
  if (planChoices === undefined) throw new FardeskError("invalid_request", `${choice} is only for a plan request (ExitPlanMode)`);
  if (!planChoices.includes(choice)) {
    throw new FardeskError("invalid_request", `${choice} is not possible for this plan request: choose one of ${planChoices.join(", ")}`);
  }
  if (choice !== REVISE) return { choice };
  if (message === undefined) throw new FardeskError("invalid_request", "revise needs a message: tell Claude what to change");
  return { choice: REVISE, message };
}
