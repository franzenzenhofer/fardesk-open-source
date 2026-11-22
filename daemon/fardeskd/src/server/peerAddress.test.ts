// #107: a request keeps the address its connection opened with, also when the client has gone before the daemon answers.
import { createServer } from "node:http";
import { connect } from "node:net";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { afterCacheExpiry, networkAddress, pairedTokenFromNetwork, phoneNode, startNetworkRig } from "../../test/support/networkNode.js";
import type { NetworkRig } from "../../test/support/networkNode.js";
import { waitUntil } from "../../test/support/env.js";
import { readAudit } from "../audit/store.js";
import { peerAddressOf, rememberPeerAddresses } from "./peerAddress.js";

const CACHE_MS = 100;
const SLOW_WHOIS_SECONDS = 1;
const RESET_AFTER_MS = 300;

let rig: NetworkRig;

const closeRig = async (): Promise<void> => {
  await rig.daemon.close();
};

/** Sends one request and then resets the connection while the daemon is still working, so the daemon answers a socket that is already gone. */
async function sendAndClose(host: string, port: number, request: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const socket = connect(port, host, () => {
      socket.write(request, () => {
        // Once the daemon has the request (it is now waiting for Tailscale), the client resets the connection.
        setTimeout(() => {
          socket.resetAndDestroy();
          resolve();
        }, RESET_AFTER_MS);
      });
    });
  });
}

describe.skipIf(networkAddress === null)("peer address of a connection", () => {
  afterEach(closeRig);

  it("keeps the audit address and the device's known lastIp for a client that sends and resets", async () => {
    rig = await startNetworkRig({}, CACHE_MS);
    rig.tailscale.setDevice(rig.address, phoneNode("node-phone-1"));
    const { token, deviceId } = await pairedTokenFromNetwork(rig);
    // The daemon now waits for Tailscale while the client is already gone: Node no longer knows the address by then.
    await afterCacheExpiry(CACHE_MS * 2);
    rig.tailscale.setWhoisDelay(SLOW_WHOIS_SECONDS);
    const body = JSON.stringify({ device: "nobody" });
    const request = `POST /v1/auth/revoke HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${token}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    await sendAndClose(rig.address, rig.daemon.config.bind.port, request);
    await waitUntil(() => readAudit(rig.daemon.config.stateDir, null).some((entry) => entry.route === "/v1/auth/revoke"));
    const lines = readAudit(rig.daemon.config.stateDir, null).filter((entry) => entry.route === "/v1/auth/revoke");
    expect(lines.map((entry) => entry.ip)).toEqual([rig.address]);
    expect(rig.daemon.services.auth.devices("").devices.find((device) => device.id === deviceId)?.lastIp).toBe(rig.address);
  });
});

describe("peerAddressOf", () => {
  it("answers the address cached at connect time after the client reset the connection", async () => {
    const answers: string[] = [];
    const server = createServer((request, response) => {
      setTimeout(() => {
        answers.push(peerAddressOf(request.socket));
        response.end();
      }, RESET_AFTER_MS * 2);
    });
    rememberPeerAddresses(server);
    await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
    const { port } = server.address() as AddressInfo;
    await sendAndClose("127.0.0.1", port, "GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    await waitUntil(() => answers.length === 1);
    server.close();
    expect(answers).toEqual(["127.0.0.1"]);
  });
});

describe("a request without an address", () => {
  afterEach(closeRig);

  it("is refused", async () => {
    rig = await startNetworkRig();
    const refused = await rig.daemon.services.auth.authenticate(rig.daemon.config.token, "unknown").then(() => null, (error: unknown) => error);
    expect(refused).toMatchObject({ code: "unauthorized" });
  });
});
