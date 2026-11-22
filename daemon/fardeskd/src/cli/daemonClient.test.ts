// Every way the CLI can fail to reach the daemon says its own reason (issue #97).
import { createServer } from "node:http";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { captureIo, writeCliConfig } from "../../test/support/cliConfig.js";
import type { CapturedIo } from "../../test/support/cliConfig.js";
import { startTestDaemon, writeConfigFile } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { freePort } from "../../test/support/env.js";
import { createFakeTailscale, putOnPath } from "../../test/support/fakeTailscale.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";
import type { CliDeps } from "./types.js";

let daemon: TestDaemon | null = null;
let silent: Server | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  await daemon?.close();
  daemon = null;
  silent?.closeAllConnections();
  const server = silent;
  silent = null;
  if (server !== null) await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
});

async function pairVia(configPath: string, deps: Partial<CliDeps>): Promise<{ code: number; io: CapturedIo }> {
  const io = captureIo();
  const code = await runCli(["pair", "--config", configPath], io, { createOwned: createRealOwned, restartWaitMs: 300, ...deps });
  return { code, io };
}

async function listenSilently(): Promise<number> {
  silent = createServer(() => undefined);
  await new Promise<void>((resolve) => silent?.listen(0, "127.0.0.1", resolve));
  return (silent.address() as { port: number }).port;
}

describe("daemon failures keep their reason", () => {
  it("a stopped daemon: says it is not running, after waiting for a restart", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const { code, io } = await pairVia(path, {});
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("fardeskd is not running (connection refused at http://127.0.0.1:");
    expect(io.err.join("\n")).toContain("the daemon may be restarting, waiting up to 0.3 s");
    home.dispose();
  });

  it("a daemon that never answers: says it timed out", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await listenSilently() });
    const { code, io } = await pairVia(path, { requestTimeoutMs: 300 });
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("did not answer within 0.3 s: it is busy or restarting");
    home.dispose();
  });

  it("a daemon error: prints the daemon's code and message", async () => {
    daemon = await startTestDaemon();
    const path = writeConfigFile({ ...daemon.config, token: "f".repeat(64) });
    const { code, io } = await pairVia(path, {});
    expect(code).toBe(1);
    expect(io.err.join("\n")).toMatch(/daemon answered HTTP 401 \(unauthorized\): \S+/);
  });

  it("no tailnet address: a command with a file fallback names Tailscale and keeps the underlying message", async () => {
    const home = createClaudeHome();
    const fake = createFakeTailscale(null);
    putOnPath(fake);
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort(), overrides: { bind: { address: "tailscale", port: 47821 } } });
    const io = captureIo();
    expect(await runCli(["devices", "--config", path], io, { createOwned: createRealOwned, tailscaleCommands: [fake.binary] })).toBe(0);
    expect(io.out[0]).toContain("is Tailscale running? (Tailscale is stopped on this computer)");
    home.dispose();
  });

  it("a command with a file fallback prints the reason and falls back", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const io = captureIo();
    expect(await runCli(["devices", "--config", path], io, { createOwned: createRealOwned, restartWaitMs: 0 })).toBe(0);
    expect(io.out[0]).toContain("fardeskd is not running (connection refused at");
    home.dispose();
  });
});
