// Pairing through a hub: the peer only ever sees the hub's own address, so the hub must run the tailnet check on the
// real caller before it forwards the anonymous pairing request. The hub listens on every interface and the test calls
// it through this computer's own network address, so the caller is not loopback and the fake tailscale is asked.
import { networkInterfaces } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { SELF_ADDRESS, createFakeTailscale } from "../../test/support/fakeTailscale.js";
import type { FakeTailscale } from "../../test/support/fakeTailscale.js";
import { PAIRING_REFUSED_MESSAGE } from "../auth/tailnetCaller.js";
import { loginResultSchema, pairCodeResultSchema } from "../contract/schema.js";

const TAILNET = "example.ts.net";
const PEER_PATH = "/m/Peer%20A/v1/auth/pair";

const address = Object.values(networkInterfaces()).flatMap((list) => list ?? []).find((entry) => entry.family === "IPv4" && !entry.internal)?.address ?? null;

let peer: TestDaemon;
let hub: TestDaemon;
let tailscale: FakeTailscale;

beforeEach(async () => {
  tailscale = createFakeTailscale(SELF_ADDRESS);
  tailscale.setDevice(SELF_ADDRESS, { name: `studio.${TAILNET}.`, login: "owner@example.com" });
  peer = await startTestDaemon({ name: "Peer A" });
  hub = await startTestDaemon(
    {
      name: "hub-box",
      hub: { enabled: true, probeMs: 200 },
      peers: [{ name: "Peer A", url: peer.url }],
      coordinator: { peerTokens: { "Peer A": TEST_TOKEN } },
    },
    { tailscaleCommands: [tailscale.binary] },
    { address: "0.0.0.0" },
  );
  for (let attempt = 0; attempt < 300 && (await hub.call("GET", "/m/Peer%20A/v1/machine")).status !== 200; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
});

afterEach(async () => {
  await hub.close();
  await peer.close();
});

const newPeerCode = async (): Promise<string> => pairCodeResultSchema.parse((await peer.call("POST", "/v1/auth/pair-code")).json).code;

async function pairThroughHubFromNetwork(code: string): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`http://${address}:${hub.config.bind.port}${PEER_PATH}`, { method: "POST", body: JSON.stringify({ code, deviceName: "Test iPhone" }) });
  return { status: response.status, json: await response.json() };
}

describe.skipIf(address === null)("anonymous pairing through the hub from another address", () => {
  it("refuses a device of another tailnet user and the peer never sees the request", async () => {
    tailscale.setDevice(address ?? "", { name: `laptop.${TAILNET}.`, login: "guest@example.com" });
    const code = await newPeerCode();
    expect(await pairThroughHubFromNetwork(code)).toEqual({ status: 403, json: { error: { code: "forbidden", message: PAIRING_REFUSED_MESSAGE } } });
    // The code was not touched: it still pairs directly on the peer.
    const direct = await peer.call("POST", "/v1/auth/pair", { code, deviceName: "Test iPhone" }, null);
    expect(direct.status).toBe(200);
  });

  it("forwards a device of the same tailnet user to the peer", async () => {
    tailscale.setDevice(address ?? "", { name: `phone.${TAILNET}.`, login: "owner@example.com" });
    const result = await pairThroughHubFromNetwork(await newPeerCode());
    expect(result.status).toBe(200);
    expect(loginResultSchema.parse(result.json).token).not.toBe(TEST_TOKEN);
  });
});
