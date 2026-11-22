import type { FixtureCases } from "./fixtureTypes.js";

const onlinePeer = {
  name: "Studio",
  online: true,
  hub: false,
  lastSeen: "2026-11-16T09:30:00.000Z",
  latencyMs: 42,
  problem: null,
  detail: null,
  sessions: 5,
  waiting: 1,
  working: 2,
  os: "macos",
} as const;

const offlinePeer = {
  name: "Laptop",
  online: false,
  hub: false,
  lastSeen: "2026-11-16T07:18:00.000Z",
  latencyMs: null,
  problem: "This computer did not answer in time (it may be asleep, or Tailscale is off there).",
  detail: "no answer within 5 s",
  sessions: 3,
  waiting: 0,
  working: 0,
} as const;

const hubSelf = {
  name: "Linux",
  online: true,
  hub: true,
  lastSeen: "2026-11-16T09:30:05.000Z",
  latencyMs: 0,
  problem: null,
  detail: null,
  sessions: 2,
  waiting: 0,
  working: 1,
  os: "linux",
} as const;

export const hubMachineFixtures: FixtureCases<"HubMachine"> = {
  online: onlinePeer,
  offline: offlinePeer,
  hub: hubSelf,
  neverSeen: { ...offlinePeer, lastSeen: null, problem: "This computer is not linked to the hub yet.", detail: "not linked: no token for it in coordinator.peerTokens", sessions: 0 },
};

export const hubStateFixtures: FixtureCases<"HubState"> = {
  threeMachines: { hub: "Linux", checkedAt: "2026-11-16T09:30:05.000Z", machines: [hubSelf, onlinePeer, offlinePeer] },
  neverSeenPeer: {
    hub: "Linux",
    checkedAt: "2026-11-16T09:30:05.000Z",
    machines: [hubSelf, { ...offlinePeer, lastSeen: null, problem: "This computer is not linked to the hub yet.", detail: "not linked: no token for it in coordinator.peerTokens", sessions: 0 }],
  },
  aloneHub: { hub: "Linux", checkedAt: "2026-11-16T09:30:05.000Z", machines: [hubSelf] },
};

export const notificationPauseRequestFixtures: FixtureCases<"NotificationPauseRequest"> = {
  oneHour: { minutes: 60 },
  resume: { minutes: 0 },
};

export const notificationStateFixtures: FixtureCases<"NotificationState"> = {
  paused: { pausedUntil: "2026-11-16T10:42:00.000Z" },
  on: { pausedUntil: null },
};
export const hiddenSessionListFixtures: FixtureCases<"HiddenSessionList"> = {
  two: {
    sessions: [
      { id: "sess_old1", title: "Fix the crawler retry", cwd: "/Users/dev/crawler", updatedAt: "2026-11-20T18:02:11.000Z" },
      { id: "sess_old2", title: "Release notes", cwd: "/Users/dev/site", updatedAt: "2026-11-18T09:40:00.000Z" },
    ],
  },
  none: { sessions: [] },
};

export const machineUpdateResultFixtures: FixtureCases<"MachineUpdateResult"> = { running: { ok: true, state: "running" } };

export const updateAllResultFixtures: FixtureCases<"UpdateAllResult"> = {
  mixedFleet: {
    source: "Studio",
    version: "4.3.0",
    machines: [
      { name: "Studio", from: "4.3.0", result: "current", message: "already on 4.3.0" },
      { name: "Linux", from: "4.2.0", result: "started", message: "installing 4.3.0, restarts when done" },
      { name: "Laptop", from: null, result: "failed", message: "Laptop did not answer" },
    ],
  },
};
