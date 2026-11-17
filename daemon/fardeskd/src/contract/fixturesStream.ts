import { activityFixtures } from "./fixturesActivity.js";
import { deniedMachine, linuxMachine, macosMachine, sessionSummaryFixtures } from "./fixturesSessions.js";
import type { FixtureCase, FixtureCases } from "./fixtureTypes.js";

function prefixedCases<Value>(
  prefix: string,
  source: Readonly<Record<string, Value>>,
  toEvent: (value: Value) => FixtureCase<"StreamEvent">,
): Readonly<Record<string, FixtureCase<"StreamEvent">>> {
  return Object.fromEntries(Object.entries(source).map(([name, value]) => [`${prefix}_${name}`, toEvent(value)]));
}

export const streamEventFixtures: FixtureCases<"StreamEvent"> = {
  helloWithSessions: {
    type: "hello",
    machine: macosMachine,
    sessions: Object.values(sessionSummaryFixtures),
  },
  helloEmpty: { type: "hello", machine: linuxMachine, sessions: [] },
  helloAutomationDenied: { type: "hello", machine: deniedMachine, sessions: [] },
  ping: { type: "ping", ts: "2026-11-14T09:12:30.000Z" },
  ...prefixedCases("session", sessionSummaryFixtures, (session) => ({ type: "session", session })),
  ...prefixedCases("activity", activityFixtures, (activity) => ({
    type: "activity",
    sessionId: "sess_7f3a91",
    activity,
  })),
};
