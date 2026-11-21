import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { ask, bash, setupBroker } from "../../test/support/brokerSetup.js";

const SHORT_TIMEOUT_MS = 30;
const QUESTION_INPUT = {
  questions: [{ question: "Tea or coffee?", header: "Drink", options: [{ label: "Tea" }, { label: "Coffee" }] }],
};

const setup = (): ReturnType<typeof setupBroker> => setupBroker(SHORT_TIMEOUT_MS);

function codeOf(action: () => unknown): string | null {
  try {
    action();
  } catch (error) {
    return error instanceof FardeskError ? error.code : "other";
  }
  return null;
}

describe("hand-off to the terminal", () => {
  it("keeps a timed-out request as terminal with its detail and records its reach", async () => {
    const { broker, events } = setup();
    const handle = broker.ask(ask(QUESTION_INPUT));
    await handle.answer;
    expect(broker.pendingKind("s1")).toBeNull();
    expect(broker.handedOff("s1", handle.requestId)).toMatchObject({
      activity: { kind: "question", text: "Tea or coffee?", options: ["Tea", "Coffee"], state: "terminal" },
      typable: false,
    });
    expect(codeOf(() => { broker.answer("s1", handle.requestId, "Tea"); })).toBe("not_found");
    broker.markReach("s1", handle.requestId, "pane");
    expect(broker.handedOff("s1", handle.requestId)?.typable).toBe(true);
    expect(events.at(-1)).toMatchObject({ activity: { state: "terminal", typable: true } });
    broker.markReach("s1", handle.requestId, "none");
    expect(broker.handedOff("s1", handle.requestId)?.typable).toBe(false);
  });

  it("types a permission only into a pane and a question also into a Ghostty terminal", async () => {
    const { broker } = setup();
    const permission = broker.ask(bash("ls"));
    const question = broker.ask(ask(QUESTION_INPUT));
    await Promise.all([permission.answer, question.answer]);
    broker.markReach("s1", permission.requestId, "ghostty");
    broker.markReach("s1", question.requestId, "ghostty");
    expect(broker.handedOff("s1", permission.requestId)?.typable).toBe(false);
    expect(broker.handedOff("s1", question.requestId)?.typable).toBe(true);
  });

  it("is never typable for several questions, multi-select, duplicate labels or a tool with its own dialog", async () => {
    const { broker } = setup();
    const [only] = QUESTION_INPUT.questions;
    const duplicate = { questions: [{ ...only, options: [{ label: "Tea" }, { label: "Tea" }] }] };
    const handles = [
      broker.ask(ask({ questions: [only, only] })),
      broker.ask(ask({ questions: [{ ...only, multiSelect: true }] })),
      broker.ask(ask(duplicate)),
      broker.ask(ask({}, "s1", "ExitPlanMode")),
    ];
    await Promise.all(handles.map((handle) => handle.answer));
    for (const handle of handles) {
      broker.markReach("s1", handle.requestId, "pane");
      expect(broker.handedOff("s1", handle.requestId)?.typable).toBe(false);
    }
  });

  it("ends when the session leaves its wait, not when the hook connection closes after the hand-off", async () => {
    const { broker } = setup();
    const handle = broker.ask(bash("ls"));
    await handle.answer;
    broker.cancelRequest("s1", handle.requestId);
    expect(broker.handedOff("s1", handle.requestId)).not.toBeNull();
    broker.cancelSession("s1");
    expect(broker.handedOff("s1", handle.requestId)).toBeNull();
    expect(broker.activities("s1")).toMatchObject([{ state: "expired" }]);
  });
});
