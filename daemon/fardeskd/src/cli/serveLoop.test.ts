import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureIo } from "../../test/support/cliConfig.js";
import type { CapturedIo } from "../../test/support/cliConfig.js";
import { createFakeTailscale, putOnPath } from "../../test/support/fakeTailscale.js";
import type { FakeTailscale } from "../../test/support/fakeTailscale.js";
import { waitUntil } from "../../test/support/env.js";
import { runCommand } from "../config/bind.js";
import { createRealOwned } from "../service/ownedFactory.js";
import type { RunningServer } from "../server/listen.js";
import { serveOnAddresses } from "./serveLoop.js";
import type { CommandContext } from "./types.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

function contextOf(io: CapturedIo): CommandContext {
  return {
    configPath: "unused",
    name: null,
    target: null,
    args: [],
    all: false,
    dryRun: false,
    since: null,
    io,
    deps: { createOwned: createRealOwned },
    run: runCommand,
    now: () => new Date(),
    tailscaleCommands: ["tailscale"],
    tailnetTiming: { initialMs: 1, capMs: 5, recheckMs: 20 },
  };
}

type Opened = { address: string; closed: boolean; port: number };

// A real HTTP server on loopback stands in for the listener on the tailnet address (a test machine has no such address).
async function openLoopback(opened: Opened[], io: CapturedIo, address: string): Promise<RunningServer> {
  const server = createServer((_request, response) => {
    response.end("ok");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const entry: Opened = { address, closed: false, port };
  opened.push(entry);
  io.stdout("fardeskd listening");
  const close = async (): Promise<void> => {
    entry.closed = true;
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  };
  return { server, address: "127.0.0.1", port, close };
}

type Run = { io: CapturedIo; opened: Opened[]; serving: Promise<void> };

// Starts serveOnAddresses on a fake tailscale that reports `address` after `failures` failed calls.
function serveWithFake(address: string | null, failures: number): { fake: FakeTailscale; run: Run } {
  const fake = createFakeTailscale(address);
  fake.failNext(failures);
  putOnPath(fake);
  const io = captureIo();
  const opened: Opened[] = [];
  const serving = serveOnAddresses(contextOf(io), null, async (found) => openLoopback(opened, io, found));
  return { fake, run: { io, opened, serving } };
}

describe("serveOnAddresses with a real tailscale executable on PATH", () => {
  it("survives three failures in one process, logs at most three lines before listening, then serves", async () => {
    const { run } = serveWithFake("100.64.0.5", 3);
    await waitUntil(() => run.opened.length === 1);
    expect(run.io.out).toEqual(["waiting for Tailscale: stopped", "using tailscale command tailscale", "tailnet address 100.64.0.5", "fardeskd listening"]);
    expect(run.opened[0]?.address).toBe("100.64.0.5");
    expect((await fetch(`http://127.0.0.1:${run.opened[0]?.port}/`)).status).toBe(200);
    run.io.stop();
    await run.serving;
    expect(run.opened[0]?.closed).toBe(true);
  });

  it("closes the listener when the address changes, goes back to waiting and listens on the new address", async () => {
    const { fake, run } = serveWithFake("100.64.0.5", 0);
    await waitUntil(() => run.opened.length === 1);
    fake.setAddress(null);
    await waitUntil(() => run.opened[0]?.closed === true);
    expect(run.io.out).toContain("tailnet address 100.64.0.5 is gone: stopped");
    // The waiting line follows the next probe (a real process start), which runs after the listener closed.
    await waitUntil(() => run.io.out.includes("waiting for Tailscale: stopped"));
    fake.setAddress("100.64.0.6");
    await waitUntil(() => run.opened.length === 2);
    expect(run.opened.map((entry) => entry.address)).toEqual(["100.64.0.5", "100.64.0.6"]);
    expect(run.opened[1]?.closed).toBe(false);
    run.io.stop();
    await run.serving;
    expect(run.opened[1]?.closed).toBe(true);
  });

  it("stops cleanly while still waiting for Tailscale", async () => {
    const { run } = serveWithFake(null, 0);
    await waitUntil(() => run.io.out.includes("waiting for Tailscale: stopped"));
    run.io.stop();
    await run.serving;
    expect(run.opened).toEqual([]);
  });
});
