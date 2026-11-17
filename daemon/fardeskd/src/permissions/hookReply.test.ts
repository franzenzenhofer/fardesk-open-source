import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import type { BrokerAnswer } from "./broker.js";
import { DENY_MESSAGE, EXPIRED_MESSAGE, sessionScopedPermissions, toHookOutput, toSdkResult } from "./hookReply.js";

// Neutral copies of two real PermissionRequest payloads (spike C).
const BASH_INPUT = { command: 'node -e "console.log(40+2)"', description: "Run node" };
const BASH_SUGGESTIONS = [
  { type: "addRules", rules: [{ toolName: "Bash", ruleContent: 'node -e "console.log(40+2)"' }], behavior: "allow", destination: "localSettings" },
];
const MODE_SUGGESTIONS = [
  { type: "addDirectories", directories: ["/work"], destination: "session" },
  { type: "setMode", mode: "acceptEdits", destination: "session" },
];
const QUESTION_INPUT = {
  questions: [
    {
      question: "Do you prefer tea or coffee?",
      header: "Drink",
      options: [
        { label: "Tea", description: "A proper cuppa." },
        { label: "Coffee", description: "Strong and caffeinated." },
      ],
      multiSelect: false,
    },
  ],
};

const bashRequest = { toolName: "Bash", toolInput: BASH_INPUT, suggestions: BASH_SUGGESTIONS };
const questionRequest = { toolName: "AskUserQuestion", toolInput: QUESTION_INPUT, suggestions: undefined };
const SESSION_RULE = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: 'node -e "console.log(40+2)"' }],
  behavior: "allow",
  destination: "session",
};

const hook = (decision: Record<string, unknown>): Record<string, unknown> => ({
  hookSpecificOutput: { hookEventName: "PermissionRequest", decision },
});

describe("sessionScopedPermissions", () => {
  it("rewrites suggested allow rules to the session destination", () => {
    expect(sessionScopedPermissions("Bash", BASH_INPUT, BASH_SUGGESTIONS)).toEqual([SESSION_RULE]);
  });

  it("drops setMode and addDirectories and builds a Bash rule from the command", () => {
    expect(sessionScopedPermissions("Bash", BASH_INPUT, MODE_SUGGESTIONS)).toEqual([SESSION_RULE]);
  });

  it("ignores non-allow rules and malformed suggestions", () => {
    const suggestions = [
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "deny", destination: "session" },
      { type: "addRules", rules: "nope", behavior: "allow" },
      "junk",
    ];
    expect(sessionScopedPermissions("Bash", BASH_INPUT, suggestions)).toEqual([SESSION_RULE]);
    expect(sessionScopedPermissions("Bash", BASH_INPUT, "not-an-array")).toEqual([SESSION_RULE]);
  });

  it("builds a bare tool rule for non-Bash tools", () => {
    expect(sessionScopedPermissions("Edit", { file_path: "/a" }, [])).toEqual([
      { type: "addRules", rules: [{ toolName: "Edit" }], behavior: "allow", destination: "session" },
    ]);
  });

  it("builds a Bash rule without content when the command is missing", () => {
    expect(sessionScopedPermissions("Bash", {}, [])).toEqual([
      { type: "addRules", rules: [{ toolName: "Bash" }], behavior: "allow", destination: "session" },
    ]);
    expect(sessionScopedPermissions("Bash", null, undefined)[0]).toMatchObject({ rules: [{ toolName: "Bash" }] });
  });

  it("keeps several suggested rules and never emits another destination", () => {
    const suggestions = [
      { type: "addRules", rules: [{ toolName: "Edit" }], behavior: "allow", destination: "userSettings" },
      { type: "addRules", rules: [{ toolName: "Write", ruleContent: "/x/**" }], behavior: "allow", destination: "projectSettings" },
    ];
    const result = sessionScopedPermissions("Edit", {}, suggestions);
    expect(result).toHaveLength(2);
    expect(result.map((entry) => [entry.type, entry.destination])).toEqual([["addRules", "session"], ["addRules", "session"]]);
  });
});

describe("toHookOutput", () => {
  it("allow", () => {
    expect(toHookOutput({ state: "allowed", always: false }, bashRequest)).toEqual(hook({ behavior: "allow" }));
  });

  it("allow always carries session scoped permissions", () => {
    expect(toHookOutput({ state: "allowed", always: true }, bashRequest)).toEqual(
      hook({ behavior: "allow", updatedPermissions: [SESSION_RULE] }),
    );
  });

  it("deny", () => {
    expect(toHookOutput({ state: "denied" }, bashRequest)).toEqual(hook({ behavior: "deny", message: DENY_MESSAGE }));
    expect(DENY_MESSAGE).toBe("Denied from Fardesk");
  });

  it("answered carries the original questions and the answer keyed by question text", () => {
    expect(toHookOutput({ state: "answered", option: "Tea" }, questionRequest)).toEqual(
      hook({
        behavior: "allow",
        updatedInput: { questions: QUESTION_INPUT.questions, answers: { "Do you prefer tea or coffee?": "Tea" } },
      }),
    );
  });

  it("expired yields no decision", () => {
    expect(toHookOutput({ state: "expired" }, bashRequest)).toBeNull();
  });

  it("answered on a non-question tool is an invalid request", () => {
    expect(() => toHookOutput({ state: "answered", option: "x" }, bashRequest)).toThrow(FardeskError);
  });
});

describe("toSdkResult", () => {
  it("allow returns the original input", () => {
    expect(toSdkResult({ state: "allowed", always: false }, bashRequest)).toEqual({ behavior: "allow", updatedInput: BASH_INPUT });
  });

  it("allow always adds session permissions", () => {
    expect(toSdkResult({ state: "allowed", always: true }, bashRequest)).toEqual({
      behavior: "allow",
      updatedInput: BASH_INPUT,
      updatedPermissions: [SESSION_RULE],
    });
  });

  it("allow with a non-object input sends an empty input", () => {
    expect(toSdkResult({ state: "allowed", always: false }, { toolName: "X", toolInput: 5, suggestions: [] })).toEqual({
      behavior: "allow",
      updatedInput: {},
    });
  });

  it("deny and expired both deny with their own message", () => {
    expect(toSdkResult({ state: "denied" }, bashRequest)).toEqual({ behavior: "deny", message: DENY_MESSAGE });
    expect(toSdkResult({ state: "expired" }, bashRequest)).toEqual({ behavior: "deny", message: EXPIRED_MESSAGE });
    expect(EXPIRED_MESSAGE).toBe("No answer from Fardesk in time");
  });

  it("answered allows with questions and answers", () => {
    const answer: BrokerAnswer = { state: "answered", option: "Coffee" };
    expect(toSdkResult(answer, questionRequest)).toEqual({
      behavior: "allow",
      updatedInput: { questions: QUESTION_INPUT.questions, answers: { "Do you prefer tea or coffee?": "Coffee" } },
    });
  });
});
