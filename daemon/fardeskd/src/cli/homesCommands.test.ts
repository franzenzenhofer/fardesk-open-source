import { describe, expect, it, afterEach } from "vitest";
import { chmodSync, mkdirSync, symlinkSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startTestDaemon, writeConfigFile } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { captureIo, writeCliConfig } from "../../test/support/cliConfig.js";
import { makeTempDir, freePort } from "../../test/support/env.js";
import { trackHomes } from "../../test/support/trackedHomes.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";

const SESSION_ID = "55555555-5555-4555-8555-555555555555";
const tracker = trackHomes();
const newHome = (): ReturnType<typeof tracker.newHome> => tracker.newHome();
let daemon: TestDaemon | null = null;

afterEach(async () => {
  tracker.disposeAll();
  await daemon?.close();
  daemon = null;
});

const psOf = (...dirs: string[]): string => dirs.map((dir, index) => `  ${100 + index} /usr/local/bin/claude TERM=xterm CLAUDE_CONFIG_DIR=${dir}`).join("\n");

async function run(argv: string[], env: { home: string; ps: string }): Promise<{ code: number; out: string[]; err: string[] }> {
  const io = captureIo({ HOME: env.home });
  const code = await runCli(argv, io, { createOwned: createRealOwned, run: () => Promise.resolve(env.ps) });
  return { code, out: io.out, err: io.err };
}

async function cliSetup(): Promise<{ configured: ReturnType<typeof newHome>; other: ReturnType<typeof newHome>; configPath: string; userHome: string }> {
  const configured = newHome();
  const other = newHome();
  const { path } = writeCliConfig({ claudeHome: configured.dir, port: await freePort() });
  return { configured, other, configPath: path, userHome: makeTempDir() };
}

const readHomes = (configPath: string): string[] => (JSON.parse(readFileSync(configPath, "utf8")) as { claudeHomes: string[] }).claudeHomes;

describe("homes and status", () => {
  it("name a home that is found but not configured, with the command to add it", async () => {
    const { configured, other, configPath, userHome } = await cliSetup();
    const env = { home: userHome, ps: psOf(configured.dir, other.dir) };
    const status = await run(["status", "--config", configPath], env);
    const unconfigured = status.out.filter((line) => line.startsWith("claude home not configured"));
    expect(unconfigured).toHaveLength(1);
    expect(unconfigured[0]).toContain(`fardeskd homes add ${other.dir}`);
    expect(unconfigured[0]).not.toContain(`add ${configured.dir}`);
    const listed = await run(["homes", "--config", configPath], env);
    expect(listed.out[0]).toBe(`configured ${configured.dir}: hooks no settings file`);
    expect(listed.out[1]).toContain(`found, not configured ${other.dir}`);
  });

  it("do not report a folder that only looks similar", async () => {
    const { configured, configPath, userHome } = await cliSetup();
    mkdirSync(join(userHome, "lookalike", "sessions"), { recursive: true });
    writeFileSync(join(userHome, "lookalike", "sessions", "agenda.txt"), "");
    const listed = await run(["homes", "--config", configPath], { home: userHome, ps: psOf(configured.dir) });
    expect(listed.out).toEqual([`configured ${configured.dir}: hooks no settings file`, "no other Claude home found"]);
    const status = await run(["status", "--config", configPath], { home: userHome, ps: "" });
    expect(status.out.some((line) => line.includes("not configured"))).toBe(false);
  });
});

describe("symlinked homes", () => {
  it("do not show up as unconfigured when the config names the link or the target, and a linked folder is found when it is not configured", async () => {
    const { configured, other, configPath, userHome } = await cliSetup();
    configured.addRegistry({ fixture: "idle", sessionId: SESSION_ID });
    other.addRegistry({ fixture: "idle", sessionId: SESSION_ID });
    symlinkSync(configured.dir, join(userHome, ".claude-link-to-configured"));
    const linkToOther = join(userHome, ".claude-link-to-other");
    symlinkSync(other.dir, linkToOther);
    const listed = await run(["homes", "--config", configPath], { home: userHome, ps: psOf(configured.dir) });
    expect(listed.out.filter((line) => line.startsWith("found, not configured"))).toEqual([expect.stringContaining(`found, not configured ${linkToOther}`)]);
    const viaLink = writeCliConfig({ claudeHome: join(userHome, ".claude-link-to-configured"), port: await freePort() });
    const again = await run(["homes", "--config", viaLink.path], { home: userHome, ps: psOf(configured.dir) });
    expect(again.out.some((line) => line.includes(configured.dir) && line.startsWith("found"))).toBe(false);
  });
});

describe("homes add", () => {
  it("rolls the config back and fails loudly when the hooks cannot be installed", async () => {
    const { configured, other, configPath, userHome } = await cliSetup();
    const before = readFileSync(configPath, "utf8");
    chmodSync(other.dir, 0o500);
    try {
      const result = await run(["homes", "add", other.dir, "--config", configPath], { home: userHome, ps: "" });
      expect(result.code).toBe(1);
      expect(result.err.join("\n")).toContain("could not install the hooks");
      expect(result.out.join("\n")).not.toContain("added");
    } finally {
      chmodSync(other.dir, 0o700);
    }
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(readHomes(configPath)).toEqual([configured.dir]);
  });


  it("installs the hooks, writes the config and says no daemon runs when none answers", async () => {
    const { configured, other, configPath, userHome } = await cliSetup();
    const result = await run(["homes", "add", other.dir, "--config", configPath], { home: userHome, ps: "" });
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).toContain(`${join(other.dir, "settings.json")}: changed PermissionRequest`);
    expect(result.out.at(-1)).toContain("no daemon answers");
    expect(readHomes(configPath)).toEqual([configured.dir, other.dir]);
    expect(existsSync(join(other.dir, "settings.json"))).toBe(true);
  });

  it("changes nothing and says so for a home that is already configured", async () => {
    const { configured, configPath, userHome } = await cliSetup();
    const before = readFileSync(configPath, "utf8");
    const result = await run(["homes", "add", configured.dir, "--config", configPath], { home: userHome, ps: "" });
    expect(result).toEqual({ code: 0, out: [`${configured.dir} is already in claudeHomes: nothing changed`], err: [] });
    expect(readFileSync(configPath, "utf8")).toBe(before);
    expect(existsSync(join(configured.dir, "settings.json"))).toBe(false);
  });

  it("refuses a path that is not a folder and a call without a path", async () => {
    const { configPath, userHome } = await cliSetup();
    const missing = await run(["homes", "add", join(userHome, "nowhere"), "--config", configPath], { home: userHome, ps: "" });
    expect(missing.code).toBe(1);
    expect(missing.err[0]).toContain("is not a folder");
    const bare = await run(["homes", "add", "--config", configPath], { home: userHome, ps: "" });
    expect(bare.code).toBe(2);
    expect(bare.err[0]).toBe("usage: fardeskd homes [add <path>]");
  });

  it("makes the running daemon list a session of the added home without a restart", async () => {
    const other = newHome();
    other.addTranscript({ fixture: "01-simple-session", sessionId: SESSION_ID });
    other.addRegistry({ fixture: "idle", sessionId: SESSION_ID });
    daemon = await startTestDaemon();
    const configPath = writeConfigFile(daemon.config);
    const userHome = makeTempDir();
    const ps = psOf(daemon.home.dir, other.dir);
    const status = await run(["status", "--config", configPath], { home: userHome, ps });
    expect(status.out.some((line) => line.includes(`fardeskd homes add ${other.dir}`))).toBe(true);
    const listIds = async (): Promise<string[]> => ((await daemon?.call("GET", "/v1/sessions"))?.json as { id: string }[]).map((session) => session.id);
    expect(await listIds()).toEqual([]);
    const added = await run(["homes", "add", other.dir, "--config", configPath], { home: userHome, ps });
    expect(added.code).toBe(0);
    expect(added.out.at(-1)).toContain("running daemon reloaded its homes");
    expect(await listIds()).toEqual([SESSION_ID]);
    expect(daemon.config.claudeHomes).toEqual([daemon.home.dir, other.dir]);
  });
});
