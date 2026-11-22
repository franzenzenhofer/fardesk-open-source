import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { createApp } from "./app.js";
import { startServer } from "./listen.js";

let daemon: TestDaemon;

afterEach(async () => {
  await daemon.close();
});

describe("startServer", () => {
  it("listens on exactly the given address and never on all interfaces", async () => {
    daemon = await startTestDaemon();
    const bound = daemon.server.server.address();
    expect(bound).toMatchObject({ address: "127.0.0.1", family: "IPv4", port: daemon.config.bind.port });
    expect(daemon.server.address).toBe("127.0.0.1");
    expect(daemon.server.port).toBe(daemon.config.bind.port);
  });

  it("serves plain HTTP", async () => {
    daemon = await startTestDaemon();
    const response = await daemon.fetch("/v1/machine", { headers: { authorization: `Bearer ${daemon.config.token}` } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: "test-mac" });
  });

  it("rejects when the port is taken", async () => {
    daemon = await startTestDaemon();
    const options = { address: "127.0.0.1", port: daemon.server.port, pingMs: 1000 };
    await expect(startServer(createApp(daemon.services), options, daemon.services.bus, daemon.services)).rejects.toThrow(/EADDRINUSE/);
  });
});
