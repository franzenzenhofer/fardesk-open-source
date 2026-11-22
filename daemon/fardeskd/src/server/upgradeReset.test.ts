import { connect } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDaemon, TEST_TOKEN } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { sleep } from "../../test/support/env.js";

// A phone that goes to the background drops its connection in the middle of a stream upgrade. On 2026-11-16 the
// rejected upgrade wrote to such a reset socket without an error listener and the whole daemon exited (ECONNRESET).
const ATTEMPTS = 40;

let daemon: TestDaemon;

beforeAll(async () => {
  daemon = await startTestDaemon();
});

afterAll(async () => {
  await daemon.close();
});

async function upgradeThenReset(path: string): Promise<void> {
  const { port } = new URL(daemon.url);
  const socket = connect({ port: Number(port), host: "127.0.0.1" });
  socket.on("error", () => undefined);
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write(
    [`GET ${path} HTTP/1.1`, "Host: 127.0.0.1", "Connection: Upgrade", "Upgrade: websocket", "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==", `Authorization: Bearer ${TEST_TOKEN}`, "", ""].join("\r\n"),
  );
  socket.destroy();
  await sleep(2);
}

describe("stream upgrades from clients that hang up", () => {
  it("survive resets during rejected and accepted upgrades, and the daemon keeps answering", async () => {
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      await upgradeThenReset(attempt % 2 === 0 ? "/v1/no-such-stream" : "/v1/stream");
    }
    expect((await daemon.call("GET", "/v1/machine")).status).toBe(200);
  });
});
