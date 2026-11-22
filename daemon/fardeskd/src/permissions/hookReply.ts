import { z } from "zod";
import type { BrokerAnswer } from "./broker.js";
import { parseAskUserQuestion } from "./describe.js";

export const DENY_MESSAGE = "Denied from Fardesk";
export const EXPIRED_MESSAGE = "No answer from Fardesk in time";
const SESSION_DESTINATION = "session";
const BASH_TOOL = "Bash";
const HOOK_EVENT_NAME = "PermissionRequest";

export type ReplyRequest = { toolName: string; toolInput: unknown; suggestions: unknown };

type PermissionRule = { toolName: string; ruleContent?: string };
export type SessionPermissionUpdate =
  | { type: "addRules"; rules: PermissionRule[]; behavior: "allow"; destination: typeof SESSION_DESTINATION }
  | { type: "setMode"; mode: "bypassPermissions" | "default"; destination: typeof SESSION_DESTINATION };

/** What Claude is told when the user wants the plan changed: the user's words follow. */
export const REVISE_PREFIX = "The user does not approve this plan yet and asks for changes: ";
const PLAN_MODES = { approve_bypass: "bypassPermissions", approve_manual: "default" } as const;

type Verdict =
  | { behavior: "allow"; updatedInput?: Record<string, unknown>; updatedPermissions?: SessionPermissionUpdate[] }
  | { behavior: "deny"; message: string };

export type SdkPermissionResult =
  | { behavior: "allow"; updatedInput: Record<string, unknown>; updatedPermissions?: SessionPermissionUpdate[] }
  | { behavior: "deny"; message: string };

const allowRulesSchema = z.looseObject({
  type: z.literal("addRules"),
  behavior: z.literal("allow"),
  rules: z.array(z.looseObject({ toolName: z.string().min(1), ruleContent: z.string().optional() })),
});

function toSessionUpdate(suggestion: unknown): SessionPermissionUpdate[] {
  const parsed = allowRulesSchema.safeParse(suggestion);
  if (!parsed.success) return [];
  const rules = parsed.data.rules.map(({ toolName, ruleContent }) =>
    ruleContent === undefined ? { toolName } : { toolName, ruleContent },
  );
  return [{ type: "addRules", rules, behavior: "allow", destination: SESSION_DESTINATION }];
}

function commandOf(toolInput: unknown): string | undefined {
  const command = (toolInput as { command?: unknown } | null)?.command;
  return typeof command === "string" ? command : undefined;
}

function ownRule(toolName: string, toolInput: unknown): PermissionRule {
  const command = toolName === BASH_TOOL ? commandOf(toolInput) : undefined;
  return command === undefined ? { toolName } : { toolName, ruleContent: command };
}

export function sessionScopedPermissions(
  toolName: string,
  toolInput: unknown,
  suggestions: unknown,
): SessionPermissionUpdate[] {
  const suggested = Array.isArray(suggestions) ? suggestions.flatMap(toSessionUpdate) : [];
  if (suggested.length > 0) return suggested;
  return [{ type: "addRules", rules: [ownRule(toolName, toolInput)], behavior: "allow", destination: SESSION_DESTINATION }];
}

function answeredInput(request: ReplyRequest, option: string): Record<string, unknown> {
  const { questions, text } = parseAskUserQuestion(request.toolInput);
  return { questions, answers: { [text]: option } };
}

/** Approving leaves plan mode in the chosen mode, like the terminal prompt; revising denies ExitPlanMode with the user's words, so Claude stays in plan mode and revises. */
function planVerdict(answer: Extract<BrokerAnswer, { state: "planned" }>): Verdict {
  if (answer.choice === "revise") return { behavior: "deny", message: `${REVISE_PREFIX}${answer.message}` };
  const mode = PLAN_MODES[answer.choice];
  return { behavior: "allow", updatedPermissions: [{ type: "setMode", mode, destination: SESSION_DESTINATION }] };
}

function verdictFor(answer: BrokerAnswer, request: ReplyRequest): Verdict | null {
  switch (answer.state) {
    case "allowed":
      return answer.always
        ? { behavior: "allow", updatedPermissions: sessionScopedPermissions(request.toolName, request.toolInput, request.suggestions) }
        : { behavior: "allow" };
    case "denied":
      return { behavior: "deny", message: DENY_MESSAGE };
    case "planned":
      return planVerdict(answer);
    case "answered":
      return { behavior: "allow", updatedInput: answeredInput(request, answer.option) };
    case "expired":
      return null;
  }
}

export function toHookOutput(answer: BrokerAnswer, request: ReplyRequest): Record<string, unknown> | null {
  const verdict = verdictFor(answer, request);
  if (verdict === null) return null;
  return { hookSpecificOutput: { hookEventName: HOOK_EVENT_NAME, decision: verdict } };
}

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

export function toSdkResult(answer: BrokerAnswer, request: ReplyRequest): SdkPermissionResult {
  const verdict = verdictFor(answer, request);
  if (verdict === null) return { behavior: "deny", message: EXPIRED_MESSAGE };
  if (verdict.behavior === "deny") return verdict;
  return { ...verdict, updatedInput: verdict.updatedInput ?? asRecord(request.toolInput) };
}
