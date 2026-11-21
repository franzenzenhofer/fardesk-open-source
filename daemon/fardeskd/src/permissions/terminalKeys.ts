// What a phone answer becomes in the terminal after a request was handed off ("Still waiting at the computer").
// Only the dialog shapes below are recognised (see "Answering a handed-off request" in public/docs/DAEMON.md);
// any other shape stays text only and is answered at the computer.
import type { PermissionDecision } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";

const ASK_USER_QUESTION = "AskUserQuestion";
const MCP_PREFIX = "mcp__";
const MAX_NUMBERED_OPTIONS = 9;
/** Tools whose permission dialog is the plain "Do you want to proceed? 1. Yes ... No" dialog. Plan approval and others differ, so they are not typed. */
const PLAIN_DIALOG_TOOLS: readonly string[] = ["Bash", "Edit", "Write", "MultiEdit", "NotebookEdit", "WebFetch"];
const ALLOW_KEY = "1";

export type TerminalShape = { kind: "question"; labels: string[] } | { kind: "permission" };

/** Where the session's terminal can be typed into; "none" when it cannot. */
export type TerminalReach = "pane" | "ghostty" | "none";

export type TerminalKey = { kind: "text"; text: string } | { kind: "escape" };

type QuestionInput = { questions?: unknown };
type QuestionEntry = { multiSelect?: unknown; options?: unknown };

function singleChoiceLabels(toolInput: unknown): string[] | null {
  const { questions } = (toolInput ?? {}) as QuestionInput;
  if (!Array.isArray(questions) || questions.length !== 1) return null;
  const [entry] = questions as QuestionEntry[];
  if (entry?.multiSelect === true || !Array.isArray(entry?.options)) return null;
  const labels = (entry.options as { label?: unknown }[]).map((option) => option.label);
  const unique = new Set(labels);
  const valid = labels.every((label): label is string => typeof label === "string" && label !== "");
  return valid && unique.size === labels.length && labels.length > 0 && labels.length <= MAX_NUMBERED_OPTIONS ? labels : null;
}

/** The recognised dialog shape of a request, or null. */
export function terminalShapeOf(toolName: string, toolInput: unknown): TerminalShape | null {
  if (toolName === ASK_USER_QUESTION) {
    const labels = singleChoiceLabels(toolInput);
    return labels === null ? null : { kind: "question", labels };
  }
  return PLAIN_DIALOG_TOOLS.includes(toolName) || toolName.startsWith(MCP_PREFIX) ? { kind: "permission" } : null;
}

/** A question can be typed into a pane or a Ghostty terminal; a permission only into a pane (Deny is the Escape key). */
export function canType(shape: TerminalShape | null, reach: TerminalReach): boolean {
  if (shape === null || reach === "none") return false;
  return shape.kind === "question" || reach === "pane";
}

export function questionKey(shape: Extract<TerminalShape, { kind: "question" }>, option: string): TerminalKey {
  const index = shape.labels.indexOf(option);
  if (index < 0) throw new FardeskError("invalid_request", `option "${option}" is not one of: ${shape.labels.join(", ")}`);
  return { kind: "text", text: String(index + 1) };
}

export function permissionKey(decision: PermissionDecision): TerminalKey {
  if (decision === "allow_always") {
    throw new FardeskError("conflict", "Always allow cannot be typed into the dialog from the phone: choose Allow or Deny, or answer at the computer");
  }
  return decision === "allow" ? { kind: "text", text: ALLOW_KEY } : { kind: "escape" };
}
