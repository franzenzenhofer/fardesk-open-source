import type { FixtureCases } from "./fixtureTypes.js";
import { deniedMachine, machineFixtures } from "./fixturesSessions.js";

const FAKE_DEVICE_TOKEN = "d0e1f2a3".repeat(8);
const [firstMachine, secondMachine] = Object.values(machineFixtures);
if (firstMachine === undefined || secondMachine === undefined) throw new Error("machine fixtures are empty");

export const pairRequestFixtures: FixtureCases<"PairRequest"> = {
  phone: { code: "Zk3vQ9mT2xLp7WcR5nYb8HdJ4sGfA1uEoIq6VtXzNaM", deviceName: "iPhone" },
};

export const pairCodeResultFixtures: FixtureCases<"PairCodeResult"> = {
  fresh: { code: "Zk3vQ9mT2xLp7WcR5nYb8HdJ4sGfA1uEoIq6VtXzNaM", expiresAt: "2026-11-17T09:10:00.000Z" },
};


export const loginResultFixtures: FixtureCases<"LoginResult"> = {
  withPeers: {
    token: FAKE_DEVICE_TOKEN,
    deviceId: "dev_01",
    machine: firstMachine,
    peers: [
      { name: "Laptop", url: "http://100.64.0.2:4780" },
      { name: "Linux", url: "http://100.64.0.3:4780" },
    ],
  },
  deniedAutomation: { token: FAKE_DEVICE_TOKEN, deviceId: "dev_03", machine: deniedMachine, peers: [] },
  noPeers: { token: FAKE_DEVICE_TOKEN, deviceId: "dev_02", machine: secondMachine, peers: [] },
  ...Object.fromEntries(
    Object.entries(machineFixtures).filter(([name]) => /^(tailscale|update)/.test(name)).map(([name, machine]) => [`${name}Login`, { token: FAKE_DEVICE_TOKEN, deviceId: "dev_04", machine, peers: [] }]),
  ),
};

export const logoutRequestFixtures: FixtureCases<"LogoutRequest"> = {
  withPush: { apnsToken: "0f1e2d3c4b5a6978".repeat(4) },
  withoutPush: { apnsToken: null },
};

export const authDeviceListFixtures: FixtureCases<"AuthDeviceList"> = {
  mixed: {
    devices: [
      {
        id: "dev_01",
        name: "iPhone",
        createdAt: "2026-11-14T08:00:00.000Z",
        lastSeenAt: "2026-11-15T09:30:00.000Z",
        lastIp: "100.64.0.9",
        revoked: false,
        current: true,
      },
      {
        id: "dev_02",
        name: "Studio CLI",
        createdAt: "2026-11-13T08:00:00.000Z",
        lastSeenAt: null,
        lastIp: null,
        revoked: true,
        current: false,
      },
    ],
  },
  none: { devices: [] },
};

export const revokeRequestFixtures: FixtureCases<"RevokeRequest"> = {
  one: { device: "iPhone" },
  all: { device: null },
};

export const revokeResultFixtures: FixtureCases<"RevokeResult"> = { two: { revoked: 2 } };
