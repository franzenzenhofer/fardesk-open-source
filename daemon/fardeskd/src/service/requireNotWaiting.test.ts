// Typed text would answer an open dialog, so a waiting session refuses it with the reason (#87).
import { describe, expect, it } from "vitest";
import type { WaitingReason } from "../contract/schema.js";
import type { SessionRecord } from "../sessions/store.js";
import { requireNotWaiting } from "./actions.js";

const record = (waitingFor: WaitingReason | null): SessionRecord =>
  ({ summary: { id: "s1", waitingFor } }) as unknown as SessionRecord;

describe("requireNotWaiting", () => {
  it("refuses while the phone has a request to answer", () => {
    expect(() => { requireNotWaiting(record("permission")); }).toThrow("waiting for a permission answer");
    expect(() => { requireNotWaiting(record("question")); }).toThrow("waiting for a question answer");
  });

  it("refuses a dialog open only at the computer, with what to do", () => {
    expect(() => { requireNotWaiting(record("terminal")); }).toThrow("answer it there or take the session over");
  });

  it("lets text through when nothing waits", () => {
    expect(() => { requireNotWaiting(record(null)); }).not.toThrow();
  });
});
