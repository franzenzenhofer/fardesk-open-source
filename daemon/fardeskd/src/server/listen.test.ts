import { readFileSync } from "node:fs";
import { request } from "node:https";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { fixturePath } from "../../test/support/env.js";
import { createApp } from "./app.js";
import { startServer } from "./listen.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

const CERT = fixturePath("apns", "localhost-test-only.crt.pem");
const KEY = fixturePath("apns", "localhost-test-only.key.pem");

async function httpsGet(port: number, path: string): Promise<{ status: number; body: string }> {
  const options = { host: "localhost", port, path, ca: readFileSync(CERT), headers: { authorization: `Bearer ${TEST_TOKEN}` } };
  return new Promise((resolve, reject) => {
    request(options, (response) => {
      let body = "";
      response.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
      response.on("end", () => { resolve({ status: response.statusCode ?? 0, body }); });
    }).on("error", reject).end();
  });
}

describe("startServer", () => {
  it("listens on exactly the given address and never on all interfaces", async () => {
    daemon = await startTestDaemon();
    const bound = daemon.server.server.address();
    expect(bound).toMatchObject({ address: "127.0.0.1", family: "IPv4", port: daemon.config.bind.port });
    expect(daemon.server.address).toBe("127.0.0.1");
    expect(daemon.server.port).toBe(daemon.config.bind.port);
  });

  it("serves HTTPS when a certificate and key are configured", async () => {
    daemon = await startTestDaemon({}, {}, { tls: { cert: CERT, key: KEY } });
    const response = await httpsGet(daemon.server.port, "/v1/machine");
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ name: "test-mac" });
  });

  it("rejects when the port is taken", async () => {
    daemon = await startTestDaemon();
    const options = { address: "127.0.0.1", port: daemon.server.port, tls: null, pingMs: 1000 };
    await expect(startServer(createApp(daemon.services), options, daemon.services.bus, daemon.services)).rejects.toThrow(/EADDRINUSE/);
  });
});
