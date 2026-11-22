// A device token counts only from the Tailscale node it was paired from (#108).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN } from "../../test/support/daemon.js";
import { afterCacheExpiry, callFromNetwork, networkAddress, pairedTokenFromNetwork, phoneNode, startNetworkRig, streamFromNetwork } from "../../test/support/networkNode.js";
import type { NetworkRig } from "../../test/support/networkNode.js";
import { SELF_ADDRESS } from "../../test/support/fakeTailscale.js";
import type { FakeDevice } from "../../test/support/fakeTailscale.js";
import { DEVICE_MOVED_MESSAGE, MASTER_WRONG_NODE_MESSAGE } from "../auth/nodeBinding.js";
import { TAILSCALE_UNAVAILABLE_MESSAGE } from "../auth/nodeIdentity.js";

const CACHE_MS = 150;
const AFTER_CACHE_MS = 300;
const MACHINE = "/v1/machine";
const HUB_ADDRESS = "100.64.0.5";

let rig: NetworkRig;

afterEach(async () => {
  await rig.daemon.close();
});

const moved = { status: 401, json: { error: { code: "device_moved", message: DEVICE_MOVED_MESSAGE } } };

/** A phone pairs from one node, then the same address answers as another node and the identity cache has expired. */
async function tokenPairedThenMoved(): Promise<string> {
  rig = await startNetworkRig({}, CACHE_MS);
  rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
  const { token } = await pairedTokenFromNetwork(rig);
  rig.tailscale.setDevice(rig.address, phoneNode("node-phone-2"));
  await afterCacheExpiry(AFTER_CACHE_MS);
  return token;
}

describe.skipIf(networkAddress === null)("device tokens are bound to their Tailscale node", () => {
  it("accepts the token from the node it was paired from and stores that node, not the user", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    const { token } = await pairedTokenFromNetwork(rig);
    expect((await callFromNetwork(rig, "GET", MACHINE, token)).status).toBe(200);
    expect(rig.daemon.services.auth.devices("").devices).toHaveLength(1);
    const stored = readFileSync(`${rig.daemon.config.stateDir}/auth-devices.json`, "utf8");
    expect(JSON.parse(stored)).toMatchObject({ devices: [{ stableId: "node-phone-1", tags: [] }] });
    expect(stored).not.toContain("100000");
  });

  it("answers 401 device_moved when the same token comes from another node, and again for every request", async () => {
    const token = await tokenPairedThenMoved();
    expect(await callFromNetwork(rig, "GET", MACHINE, token)).toEqual(moved);
    expect(await callFromNetwork(rig, "POST", "/v1/auth/rotate-token", token)).toEqual(moved);
  });

  it("binds StableID plus tags for a tagged node: another node with the same tag, or the same node with other tags, is moved", async () => {
    rig = await startNetworkRig({ pairing: { allowedTags: ["tag:ci"] } }, CACHE_MS);
    const tagged = (stableId: string, tags: string[]): FakeDevice => ({ name: "runner.example.ts.net.", login: "tagged-devices", stableId, tags });
    rig.tailscale.setDevice(rig.address, tagged("node-runner-1", ["tag:ci"]));
    const { token } = await pairedTokenFromNetwork(rig);
    expect((await callFromNetwork(rig, "GET", MACHINE, token)).status).toBe(200);
    rig.tailscale.setDevice(rig.address, tagged("node-runner-2", ["tag:ci"]));
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect(await callFromNetwork(rig, "GET", MACHINE, token)).toEqual(moved);
    rig.tailscale.setDevice(rig.address, tagged("node-runner-1", ["tag:ci", "tag:extra"]));
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect(await callFromNetwork(rig, "GET", MACHINE, token)).toEqual(moved);
    rig.tailscale.setDevice(rig.address, tagged("node-runner-1", ["tag:ci"]));
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect((await callFromNetwork(rig, "GET", MACHINE, token)).status).toBe(200);
  });

  it("fails closed with 503 tailscale_unavailable when whois fails, and recovers when it answers again", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    const { token } = await pairedTokenFromNetwork(rig);
    rig.tailscale.setAddress(null);
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect(await callFromNetwork(rig, "GET", MACHINE, token)).toEqual({ status: 503, json: { error: { code: "tailscale_unavailable", message: TAILSCALE_UNAVAILABLE_MESSAGE } } });
    rig.tailscale.setAddress(SELF_ADDRESS);
    expect((await callFromNetwork(rig, "GET", MACHINE, token)).status).toBe(200);
  });

  it("answers 401 for a source address Tailscale does not know", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    const { token } = await pairedTokenFromNetwork(rig);
    rig.tailscale.clearDevice(rig.address);
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect((await callFromNetwork(rig, "GET", MACHINE, token)).status).toBe(401);
  });
});

describe.skipIf(networkAddress === null)("the master token counts only from this computer or its hub", () => {
  it("is refused from another node with 401 master_token_wrong_node", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    expect(await callFromNetwork(rig, "GET", MACHINE, TEST_TOKEN)).toEqual({ status: 401, json: { error: { code: "master_token_wrong_node", message: MASTER_WRONG_NODE_MESSAGE } } });
  });

  it("is accepted from loopback and from the node of this computer itself", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    expect((await rig.daemon.call("GET", MACHINE)).status).toBe(200);
    rig.tailscale.setDevice(rig.address, { ...phoneNode("node-self"), name: "studio.example.ts.net." });
    expect((await callFromNetwork(rig, "GET", MACHINE, TEST_TOKEN)).status).toBe(200);
  });

  it("is accepted from the configured hub's node and refused when that address is another node", async () => {
    rig = await startNetworkRig({ hubAddress: HUB_ADDRESS }, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-hub"));
    rig.tailscale.setDevice(HUB_ADDRESS, { name: "hub.example.ts.net.", login: "owner@example.com", stableId: "node-hub" });
    expect((await callFromNetwork(rig, "GET", MACHINE, TEST_TOKEN)).status).toBe(200);
    rig.tailscale.setDevice(HUB_ADDRESS, { name: "hub.example.ts.net.", login: "owner@example.com", stableId: "node-other-hub" });
    await afterCacheExpiry(AFTER_CACHE_MS);
    expect((await callFromNetwork(rig, "GET", MACHINE, TEST_TOKEN)).status).toBe(401);
  });
});

describe.skipIf(networkAddress === null)("an open stream follows the node", () => {
  it("is closed with 1008 after the node of its token changes", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    const { token } = await pairedTokenFromNetwork(rig);
    const ws = streamFromNetwork(rig, token);
    await new Promise<void>((resolve, reject) => { ws.once("open", () => { resolve(); }); ws.once("error", reject); });
    const closed = new Promise<{ code: number; reason: string }>((resolve) => { ws.once("close", (code, reason) => { resolve({ code, reason: reason.toString() }); }); });
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-2"));
    expect(await closed).toEqual({ code: 1008, reason: "device_moved" });
  });

  it("is refused at upgrade with 401 device_moved when the token comes from another node", async () => {
    const token = await tokenPairedThenMoved();
    const ws = streamFromNetwork(rig, token);
    const status = await new Promise<number>((resolve) => { ws.once("unexpected-response", (_request, response) => { resolve(response.statusCode ?? 0); }); });
    expect(status).toBe(401);
  });
});

