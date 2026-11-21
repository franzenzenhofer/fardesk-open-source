import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { captureIo, runWithoutProcesses, writeCliConfig } from "../../test/support/cliConfig.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { fixturePath, freePort, makeTempDir, portAccepts, waitUntil } from "../../test/support/env.js";
import { createFakeTailscale, putOnPath } from "../../test/support/fakeTailscale.js";
import { networkInterfaces } from "node:os";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";

const deps = { createOwned: createRealOwned, run: runWithoutProcesses };
type JsonFile = { name: string; hooks: Record<string, unknown[]> };
const readJson = (path: string): JsonFile => JSON.parse(readFileSync(path, "utf8")) as JsonFile;
const NOW = new Date("2026-11-15T10:00:00.000Z");
const homes: ClaudeHome[] = [];
let daemon: TestDaemon | null = null;

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const home of homes.splice(0)) home.dispose();
  await daemon?.close();
  daemon = null;
});

async function setup(overrides: Record<string, unknown> = {}): Promise<{ home: ClaudeHome; configPath: string; stateDir: string; port: number }> {
  const home = createClaudeHome();
  homes.push(home);
  const port = await freePort();
  const { path, stateDir } = writeCliConfig({ claudeHome: home.dir, port, overrides });
  return { home, configPath: path, stateDir, port };
}

async function run(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number; out: string[]; err: string[] }> {
  const io = captureIo(env);
  const code = await runCli(argv, io, { ...deps, now: () => NOW });
  return { code, out: io.out, err: io.err };
}

describe("usage", () => {
  it("prints help on stdout with exit 0", async () => {
    const result = await run(["--help"]);
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).toContain("fardeskd <command>");
  });

  it.each([[["bogus"]], [[]], [["--nonsense"]]])("prints usage on stderr with exit 2 for %j", async (argv) => {
    const result = await run(argv);
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain("usage: fardeskd");
    expect(result.out).toEqual([]);
  });

  it("reads the config path from FARDESK_CONFIG in the io env, then from the process default", async () => {
    const { configPath } = await setup();
    expect((await run(["status"], { FARDESK_CONFIG: configPath })).out[0]).toBe(`config: ${configPath}`);
    vi.stubEnv("FARDESK_CONFIG", configPath);
    expect((await run(["status"])).out[0]).toBe(`config: ${configPath}`);
  });

  it("exits 1 with the error message when the config cannot be loaded", async () => {
    const result = await run(["status", "--config", join(makeTempDir(), "missing.json")]);
    expect(result.code).toBe(1);
    expect(result.err[0]).toContain("cannot read config file");
  });
});

describe("init", () => {
  it("writes a config once and refuses to overwrite it", async () => {
    const path = join(makeTempDir(), "sub", "config.json");
    const first = await run(["init", "--name", "box", "--config", path]);
    expect(first.code).toBe(0);
    expect(readJson(path).name).toBe("box");
    const second = await run(["init", "--name", "box", "--config", path]);
    expect(second.code).toBe(1);
    expect(second.err[0]).toContain("already exists");
  });

  it("needs a name", async () => {
    const result = await run(["init", "--config", join(makeTempDir(), "c.json")]);
    expect(result.code).toBe(2);
    expect(result.err[0]).toContain("--name");
  });
});

describe("install-hooks and uninstall-hooks", () => {
  it("creates settings, is idempotent, backs up an existing file and removes the hooks again", async () => {
    const { home, configPath } = await setup();
    const settings = join(home.dir, "settings.json");
    const created = await run(["install-hooks", "--config", configPath]);
    expect(created.out[0]).toContain(`${settings}: changed PermissionRequest, SessionEnd, SessionStart, Stop; no backup`);
    expect((await run(["install-hooks", "--config", configPath])).out).toEqual([`${settings}: unchanged`]);
    const removed = await run(["uninstall-hooks", "--config", configPath]);
    expect(removed.out[0]).toContain("changed");
    expect(removed.out[0]).toContain(`backup ${settings}.fardesk-bak-20261115-100000`);
    expect((await run(["uninstall-hooks", "--config", configPath])).out).toEqual([`${settings}: unchanged`]);
    copyFileSync(fixturePath("hooks", "settings", "existing-hooks.json"), settings);
    const merged = await run(["install-hooks", "--config", configPath]);
    expect(merged.out[0]).toContain("backup");
    expect(readJson(settings).hooks.Stop).toHaveLength(2);
  });

  it("derives the PermissionRequest timeouts from permissionTimeoutSeconds (default 15 minutes) in every configured home", async () => {
    const second = createClaudeHome();
    homes.push(second);
    const { home, configPath } = await setup();
    const timeoutsOf = (dir: string): { timeout: number; command: string }[] =>
      (readJson(join(dir, "settings.json")).hooks["PermissionRequest"] as { hooks: { timeout: number; command: string }[] }[]).flatMap((group) => group.hooks);
    const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
    writeFileSync(configPath, JSON.stringify({ ...config, claudeHomes: [home.dir, second.dir] }));
    await run(["install-hooks", "--config", configPath]);
    for (const dir of [home.dir, second.dir]) {
      expect(timeoutsOf(dir)).toEqual([expect.objectContaining({ timeout: 910, command: expect.stringContaining("curl -sf -m 905 ") as string })]);
    }
    writeFileSync(configPath, JSON.stringify({ ...config, claudeHomes: [home.dir, second.dir], permissionTimeoutSeconds: 300 }));
    expect((await run(["install-hooks", "--config", configPath])).out.join("\n")).toContain("changed PermissionRequest");
    for (const dir of [home.dir, second.dir]) {
      expect(timeoutsOf(dir)).toEqual([expect.objectContaining({ timeout: 310, command: expect.stringContaining("curl -sf -m 305 ") as string })]);
    }
  });

  it("works with the real clock when none is injected", async () => {
    const { configPath } = await setup();
    const io = captureIo();
    expect(await runCli(["install-hooks", "--config", configPath], io, deps)).toBe(0);
    expect(io.out[0]).toContain("changed");
  });

  it("uninstalling without a settings file changes nothing", async () => {
    const { home, configPath } = await setup();
    expect((await run(["uninstall-hooks", "--config", configPath])).out).toEqual([`${join(home.dir, "settings.json")}: unchanged`]);
  });
});

describe("pair", () => {
  it("fails with a clear message when no daemon runs, because the code lives in the daemon", async () => {
    const { configPath } = await setup();
    const result = await run(["pair", "--config", configPath]);
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("start fardeskd first");
  });
});

describe("status", () => {
  it("reports hook state per settings file and a daemon that does not answer", async () => {
    const { home, configPath } = await setup();
    const settings = join(home.dir, "settings.json");
    const lines = async (): Promise<string> => (await run(["status", "--config", configPath])).out.join("\n");
    const missing = await lines();
    expect(missing).toContain("daemon: does not answer");
    expect(missing).toContain(`hooks ${settings}: no settings file`);
    writeFileSync(settings, "{}");
    expect(await lines()).toContain("not installed");
    await run(["install-hooks", "--config", configPath]);
    expect(await lines()).toContain(`hooks ${settings}: installed`);
    const installed = readJson(settings);
    delete installed.hooks.Stop;
    writeFileSync(settings, JSON.stringify(installed));
    expect(await lines()).toContain(`hooks ${settings}: partial`);
    writeFileSync(settings, "not json");
    expect(await lines()).toContain(`hooks ${settings}: unreadable (`);
  });

  it("reports a running daemon, a rejected token and an unresolvable bind address", async () => {
    daemon = await startTestDaemon();
    const live = writeCliConfig({ claudeHome: daemon.home.dir, port: daemon.config.bind.port });
    expect((await run(["status", "--config", live.path])).out.join("\n")).toContain("daemon: answers GET /v1/machine");
    const wrongToken = writeCliConfig({ claudeHome: daemon.home.dir, port: daemon.config.bind.port, overrides: { token: "z".repeat(40) } });
    expect((await run(["status", "--config", wrongToken.path])).out.join("\n")).toContain("answered HTTP 401");
    const tailscale = writeCliConfig({ claudeHome: daemon.home.dir, port: 1, overrides: { bind: { address: "tailscale", port: 1 } } });
    const io = captureIo();
    const code = await runCli(["status", "--config", tailscale.path], io, { ...deps, run: async () => Promise.reject(new Error("tailscale is not running")) });
    expect(code).toBe(0);
    expect(io.out).toContain("Tailscale is stopped on this computer");
    expect(io.out.join("\n")).not.toContain("bind address");
  });
});

describe("serve", () => {

  it("serves until told to stop, then releases the port and the hook socket", async () => {
    const { configPath, stateDir, port } = await setup();
    const io = captureIo();
    const exit = runCli(["serve", "--config", configPath], io, deps);
    await waitUntil(() => io.out.some((line) => line.includes("listening")));
    expect(io.out[0]).toBe(`fardeskd listening on http://127.0.0.1:${port}`);
    expect((await fetch(`http://127.0.0.1:${port}/v1/machine`, { headers: { authorization: "Bearer " + "k".repeat(48) } })).status).toBe(200);
    expect(existsSync(join(stateDir, "hook.sock"))).toBe(true);
    io.stop();
    expect(await exit).toBe(0);
    expect(existsSync(join(stateDir, "hook.sock"))).toBe(false);
    expect(await portAccepts(port)).toBe(false);
  });

  it("closes everything and exits 1 when the port is taken", async () => {
    daemon = await startTestDaemon();
    const { configPath, stateDir } = await setup({ bind: { address: "127.0.0.1", port: daemon.config.bind.port } });
    const io = captureIo();
    expect(await runCli(["serve", "--config", configPath], io, deps)).toBe(1);
    expect(io.err[0]).toContain("EADDRINUSE");
    expect(existsSync(join(stateDir, "hook.sock"))).toBe(false);
  });
});

describe("status with Tailscale off", () => {
  it("prints one plain line for the stopped state and no stack trace, using a real tailscale executable on PATH", async () => {
    const fake = createFakeTailscale(null);
    putOnPath(fake);
    const { configPath } = await setup({ bind: { address: "tailscale", port: 1 } });
    const io = captureIo();
    expect(await runCli(["status", "--config", configPath], io, { ...deps, tailscaleCommands: ["tailscale"] })).toBe(0);
    expect(io.out).toContain("Tailscale is stopped on this computer");
    expect(io.out.join("\n")).not.toMatch(/\n\s+at /);
    expect(io.err).toEqual([]);
  });

  it("names the address when Tailscale runs", async () => {
    const fake = createFakeTailscale("100.64.0.5");
    putOnPath(fake);
    const { configPath } = await setup({ bind: { address: "tailscale", port: 1 } });
    const io = captureIo();
    await runCli(["status", "--config", configPath], io, { ...deps, tailscaleCommands: ["tailscale"] });
    expect(io.out).toContain("Tailscale: running, address 100.64.0.5");
    expect(io.out).toContain("bind address: http://100.64.0.5:1");
  });
});

const localTailnetAddress = Object.values(networkInterfaces())
  .flat()
  .map((entry) => entry?.address ?? "")
  .find((address) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address));

describe.runIf(localTailnetAddress !== undefined)("serve with Tailscale (needs a real tailnet address on this computer)", () => {
  it("waits through failing tailscale calls in one process, then listens on the tailnet address", async () => {
    const fake = createFakeTailscale(localTailnetAddress ?? null);
    fake.failNext(3);
    putOnPath(fake);
    const port = await freePort();
    const { configPath } = await setup({ bind: { address: "tailscale", port } });
    const io = captureIo();
    const exit = runCli(["serve", "--config", configPath], io, { ...deps, tailscaleCommands: ["tailscale"], tailnetTiming: { initialMs: 1, capMs: 5, recheckMs: 50 } });
    await waitUntil(() => io.out.some((line) => line.startsWith("fardeskd listening")));
    expect(io.out.findIndex((line) => line.startsWith("fardeskd listening"))).toBeLessThanOrEqual(3);
    expect(io.out.at(-1)).toBe(`fardeskd listening on http://${localTailnetAddress}:${port}`);
    io.stop();
    expect(await exit).toBe(0);
    expect(await portAccepts(port)).toBe(false);
  });
});
