import type { FixtureCases } from "./fixtureTypes.js";

const onlinePeer = {
  name: "Studio",
  online: true,
  hub: false,
  lastSeen: "2026-11-16T09:30:00.000Z",
  latencyMs: 42,
  problem: null,
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
  problem: "no answer within 5 s",
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
  sessions: 2,
  waiting: 0,
  working: 1,
  os: "linux",
} as const;

export const hubMachineFixtures: FixtureCases<"HubMachine"> = {
  online: onlinePeer,
  offline: offlinePeer,
  hub: hubSelf,
  neverSeen: { ...offlinePeer, lastSeen: null, problem: "not linked: no token for it in coordinator.peerTokens", sessions: 0 },
};

export const hubStateFixtures: FixtureCases<"HubState"> = {
  threeMachines: { hub: "Linux", checkedAt: "2026-11-16T09:30:05.000Z", machines: [hubSelf, onlinePeer, offlinePeer] },
  neverSeenPeer: {
    hub: "Linux",
    checkedAt: "2026-11-16T09:30:05.000Z",
    machines: [hubSelf, { ...offlinePeer, lastSeen: null, problem: "not linked: no token for it in coordinator.peerTokens", sessions: 0 }],
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
