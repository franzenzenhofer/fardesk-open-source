import { describe, expect, it } from "vitest";
import { createBus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import type { StreamEvent } from "../contract/schema.js";
import type { FinishedToolCall } from "../transcript/index.js";
import { sleep } from "../../test/support/env.js";
import { HISTORY_LIMIT, createBroker, type AskInput, type Broker } from "./broker.js";

const NOW = new Date("2026-11-15T10:00:00.000Z");
const SHORT_TIMEOUT_MS = 50;
const LONG_TIMEOUT_MS = 60_000;
const QUESTION_INPUT = {
  questions: [{ question: "Tea or coffee?", header: "Drink", options: [{ label: "Tea" }, { label: "Coffee" }] }],
};
const FREE_TEXT_INPUT = { questions: [{ question: "Your name?", options: [] }] };

function setup(timeoutMs = LONG_TIMEOUT_MS): { broker: Broker; events: StreamEvent[] } {
  const bus = createBus();
  const events: StreamEvent[] = [];
  bus.subscribe((event) => events.push(event));
  let counter = 0;
  const broker = createBroker({ timeoutMs, bus, now: () => NOW, newId: () => `id${String(++counter)}` });
  return { broker, events };
}

const bash = (command: string): AskInput => ({ sessionId: "s1", toolName: "Bash", toolInput: { command }, cwd: "/work" });
const ask = (input: unknown, sessionId = "s1"): AskInput => ({ sessionId, toolName: "AskUserQuestion", toolInput: input, cwd: "/work" });

const finishedBash = (command: string, startOffsetMs: number): FinishedToolCall => ({
  id: "toolu_bash",
  tool: "Bash",
  input: { command },
  startedAt: new Date(NOW.getTime() + startOffsetMs).toISOString(),
});

function expectCode(action: () => unknown, code: string): void {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FardeskError);
    expect((error as FardeskError).code).toBe(code);
    return;
  }
  throw new Error("expected FardeskError");
}

describe("broker permissions", () => {
  it("publishes a pending permission activity and resolves on allow", async () => {
    const { broker, events } = setup();
    const { requestId, answer } = broker.ask(bash("ls"));
    expect(requestId).toBe("id1");
    expect(events).toEqual([
      {
        type: "activity",
        sessionId: "s1",
        activity: {
          id: "req-id1",
          ts: NOW.toISOString(),
          kind: "permission",
          requestId: "id1",
          tool: "Bash",
          title: "Allow command?",
          summary: "ls",
          cwd: "/work",
          destructive: false,
          state: "pending",
        },
      },
    ]);
    expect(broker.pendingKind("s1")).toBe("permission");
    broker.decide("s1", requestId, "allow");
    expect(await answer).toEqual({ state: "allowed", always: false });
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ activity: { id: "req-id1", state: "allowed" } });
    expect(broker.pendingKind("s1")).toBeNull();
    broker.close();
  });

  it("maps allow_always and deny", async () => {
    const { broker, events } = setup();
    const first = broker.ask(bash("ls"));
    const second = broker.ask(bash("rm -rf x"));
    expect(broker.activities("s1")).toMatchObject([{ destructive: false }, { destructive: true }]);
    broker.decide("s1", first.requestId, "allow_always");
    broker.decide("s1", second.requestId, "deny");
    expect(await first.answer).toEqual({ state: "allowed", always: true });
    expect(await second.answer).toEqual({ state: "denied" });
    expect(events.map((e) => (e.type === "activity" ? e.activity : null))).toMatchObject([
      { state: "pending" },
      { state: "pending" },
      { state: "allowed" },
      { state: "denied" },
    ]);
  });

  it("rejects unknown, foreign, resolved and wrong-kind decisions", async () => {
    const { broker } = setup();
    const permission = broker.ask(bash("ls"));
    const question = broker.ask(ask(QUESTION_INPUT));
    expectCode(() => { broker.decide("s1", "nope", "allow"); }, "not_found");
    expectCode(() => { broker.decide("other", permission.requestId, "allow"); }, "not_found");
    expectCode(() => { broker.decide("s1", question.requestId, "allow"); }, "invalid_request");
    broker.decide("s1", permission.requestId, "allow");
    await permission.answer;
    expectCode(() => { broker.decide("s1", permission.requestId, "deny"); }, "not_found");
    broker.close();
    await question.answer;
  });

  it("expires after the timeout", async () => {
    const { broker, events } = setup(SHORT_TIMEOUT_MS);
    const { answer } = broker.ask(bash("ls"));
    expect(await answer).toEqual({ state: "expired", timedOut: true });
    expect(events[1]).toMatchObject({ activity: { state: "expired" } });
    expect(broker.pendingKind("s1")).toBeNull();
  });

  it("does not expire a request that was decided before the timeout", async () => {
    const { broker, events } = setup(SHORT_TIMEOUT_MS);
    const { requestId, answer } = broker.ask(bash("ls"));
    broker.decide("s1", requestId, "allow");
    await answer;
    await sleep(SHORT_TIMEOUT_MS * 2);
    expect(events).toHaveLength(2);
  });

  it("a timeout is marked as timed out, every other expiry is not (only a timeout hands off to the terminal)", async () => {
    const { broker } = setup();
    const closed = broker.ask(bash("ls"));
    broker.cancelRequest("s1", closed.requestId);
    expect(await closed.answer).toEqual({ state: "expired" });
    broker.cancelRequest("s1", closed.requestId);
    broker.cancelRequest("unknown", "nope");
  });

  it("toolFinished expires the pending request of that tool call only", async () => {
    const { broker } = setup();
    const mine = broker.ask(bash("ls"));
    const otherTool = broker.ask({ ...bash("ls"), toolName: "Edit", toolInput: { file_path: "/work/a.txt", old_string: "a", new_string: "b" } });
    const otherSession = broker.ask({ ...bash("ls"), sessionId: "s2" });
    broker.toolFinished("s1", finishedBash("ls", -200));
    expect(await mine.answer).toEqual({ state: "expired" });
    expect(broker.pendingKind("s2")).toBe("permission");
    expect(broker.pendingKind("s1")).toBe("permission");
    broker.toolFinished("s1", finishedBash("ls", -3_600_000));
    expect(broker.pendingKind("s1")).toBe("permission");
    broker.close();
    await Promise.all([otherTool.answer, otherSession.answer]);
  });

  it("a parallel call that finished does not end the request of another call (same tool, other input; other tool)", async () => {
    const { broker } = setup();
    const pending = broker.ask(bash("rm x"));
    broker.toolFinished("s1", finishedBash("ls", -100));
    broker.toolFinished("s1", { id: "toolu_read", tool: "Read", input: { file_path: "/work/a.txt" }, startedAt: new Date(NOW.getTime() - 100).toISOString() });
    expect(broker.pendingKind("s1")).toBe("permission");
    broker.toolFinished("s1", finishedBash("rm x", -100));
    expect(await pending.answer).toEqual({ state: "expired" });
    broker.close();
  });

  it("cancelSession expires only that session's pending entries", async () => {
    const { broker } = setup();
    const mine = broker.ask(bash("ls"));
    const other = broker.ask({ ...bash("pwd"), sessionId: "s2" });
    broker.cancelSession("s1");
    expect(await mine.answer).toEqual({ state: "expired" });
    expect(broker.pendingKind("s2")).toBe("permission");
    broker.cancelSession("unknown");
    broker.close();
    expect(await other.answer).toEqual({ state: "expired" });
  });
});

describe("broker questions", () => {
  it("publishes a question and resolves on a valid option", async () => {
    const { broker, events } = setup();
    const { requestId, answer } = broker.ask(ask(QUESTION_INPUT));
    expect(events[0]).toMatchObject({
      activity: { kind: "question", id: "req-id1", text: "Tea or coffee?", options: ["Tea", "Coffee"], state: "pending" },
    });
    expect(broker.pendingKind("s1")).toBe("question");
    broker.answer("s1", requestId, "Coffee");
    expect(await answer).toEqual({ state: "answered", option: "Coffee" });
    expect(events[1]).toMatchObject({ activity: { kind: "question", state: "answered" } });
  });

  it("rejects an option outside the list, accepts free text when there are no options", async () => {
    const { broker } = setup();
    const choice = broker.ask(ask(QUESTION_INPUT));
    expectCode(() => { broker.answer("s1", choice.requestId, "Milk"); }, "invalid_request");
    const free = broker.ask(ask(FREE_TEXT_INPUT));
    broker.answer("s1", free.requestId, "Alex");
    expect(await free.answer).toEqual({ state: "answered", option: "Alex" });
    broker.close();
    await choice.answer;
  });

  it("rejects answers for unknown ids, resolved questions and permissions", async () => {
    const { broker } = setup();
    const permission = broker.ask(bash("ls"));
    const question = broker.ask(ask(FREE_TEXT_INPUT));
    expectCode(() => { broker.answer("s1", "nope", "x"); }, "not_found");
    expectCode(() => { broker.answer("s1", permission.requestId, "x"); }, "invalid_request");
    broker.answer("s1", question.requestId, "x");
    await question.answer;
    expectCode(() => { broker.answer("s1", question.requestId, "x"); }, "not_found");
    broker.close();
    await permission.answer;
  });

  it("expires a question on timeout", async () => {
    const { broker, events } = setup(SHORT_TIMEOUT_MS);
    expect(await broker.ask(ask(FREE_TEXT_INPUT)).answer).toEqual({ state: "expired", timedOut: true });
    expect(events[1]).toMatchObject({ activity: { kind: "question", state: "expired" } });
  });

  it("throws invalid_request for a malformed question without creating an entry", () => {
    const { broker, events } = setup();
    expectCode(() => broker.ask(ask({})), "invalid_request");
    expect(events).toHaveLength(0);
    expect(broker.activities("s1")).toEqual([]);
  });
});

describe("broker history", () => {
  it("returns activities oldest first and the oldest pending kind", async () => {
    const { broker } = setup();
    const first = broker.ask(bash("ls"));
    broker.ask(ask(FREE_TEXT_INPUT));
    broker.decide("s1", first.requestId, "allow");
    await first.answer;
    expect(broker.activities("s1").map((a) => a.id)).toEqual(["req-id1", "req-id2"]);
    expect(broker.pendingKind("s1")).toBe("question");
    expect(broker.activities("none")).toEqual([]);
    broker.close();
  });

  it("caps history by dropping the oldest resolved entries first", async () => {
    const { broker } = setup();
    const pending = broker.ask(bash("keep-me"));
    for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
      const entry = broker.ask(bash(`cmd ${String(index)}`));
      broker.decide("s1", entry.requestId, "allow");
      await entry.answer;
    }
    const ids = broker.activities("s1").map((a) => a.id);
    expect(ids).toHaveLength(HISTORY_LIMIT);
    expect(ids[0]).toBe(`req-${pending.requestId}`);
    expect(ids).not.toContain("req-id2");
    broker.close();
  });

  it("never drops pending entries, even beyond the cap", async () => {
    const { broker } = setup();
    const entries = Array.from({ length: HISTORY_LIMIT + 3 }, () => broker.ask(bash("ls")));
    expect(broker.activities("s1")).toHaveLength(HISTORY_LIMIT + 3);
    broker.close();
    await Promise.all(entries.map((entry) => entry.answer));
    expect(broker.activities("s1")).toHaveLength(HISTORY_LIMIT);
  });
});
