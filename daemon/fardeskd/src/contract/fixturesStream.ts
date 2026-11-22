import { activityFixtures } from "./fixturesActivity.js";
import { deniedMachine, linuxMachine, machineFixtures, macosMachine, sessionSummaryFixtures } from "./fixturesSessions.js";
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
    sessions: Object.entries(sessionSummaryFixtures).filter(([name]) => name !== "waitingTerminal" && !["labelledPreset", "labelledCustom", "autoColoured"].includes(name)).map(([, session]) => session),
  },
  helloEmpty: { type: "hello", machine: linuxMachine, sessions: [] },
  helloAutomationDenied: { type: "hello", machine: deniedMachine, sessions: [] },
  ...prefixedCases("hello", Object.fromEntries(Object.entries(machineFixtures).filter(([name]) => /^(tailscale|update)/.test(name))), (machine) => ({ type: "hello", machine, sessions: [] })),
  ping: { type: "ping", ts: "2026-11-14T09:12:30.000Z" },
  ...prefixedCases("session", sessionSummaryFixtures, (session) => ({ type: "session", session })),
  ...prefixedCases("activity", activityFixtures, (activity) => ({
    type: "activity",
    sessionId: "sess_7f3a91",
    activity,
  })),
};
