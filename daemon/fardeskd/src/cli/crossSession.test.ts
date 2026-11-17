import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { captureIo, writeCliConfig } from "../../test/support/cliConfig.js";
import { freePort } from "../../test/support/env.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";

const homes: ClaudeHome[] = [];

afterEach(() => {
  for (const home of homes.splice(0)) home.dispose();
});

async function setup(settings: string | null): Promise<{ home: ClaudeHome; configPath: string; settingsPath: string }> {
  const home = createClaudeHome();
  homes.push(home);
  const settingsPath = join(home.dir, "settings.json");
  if (settings !== null) writeFileSync(settingsPath, settings);
  const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
  return { home, configPath: path, settingsPath };
}

async function run(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const io = captureIo();
  const code = await runCli(argv, io, { createOwned: createRealOwned });
  return { code, out: io.out, err: io.err };
}

const backups = (home: ClaudeHome): string[] => readdirSync(home.dir).filter((name) => name.includes(".fardesk-bak-"));

describe("cross-session", () => {
  it("accept sets the key with a backup, keeps everything else, and is idempotent", async () => {
    const { home, configPath, settingsPath } = await setup(JSON.stringify({ theme: "dark", hooks: { Stop: [] } }));
    const first = await run(["cross-session", "accept", "--config", configPath]);
    expect(first.code).toBe(0);
    expect(first.out[0]).toContain("changed (accept); backup");
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ theme: "dark", hooks: { Stop: [] }, crossSessionInbound: "accept" });
    expect(backups(home)).toHaveLength(1);
    expect((await run(["cross-session", "accept", "--config", configPath])).out[0]).toContain("unchanged");
    expect(backups(home)).toHaveLength(1);
  });

  it("unset removes the key; a missing settings file is created by accept and untouched by unset", async () => {
    const { home, configPath, settingsPath } = await setup(JSON.stringify({ crossSessionInbound: "accept", theme: "dark" }));
    expect((await run(["cross-session", "unset", "--config", configPath])).out[0]).toContain("changed (unset)");
    expect(JSON.parse(readFileSync(settingsPath, "utf8"))).toEqual({ theme: "dark" });
    const fresh = await setup(null);
    expect((await run(["cross-session", "unset", "--config", fresh.configPath])).out[0]).toContain("changed");
    expect(existsSync(fresh.settingsPath)).toBe(true);
    expect(backups(home)).toHaveLength(1);
  });

  it("needs accept or unset", async () => {
    const { configPath } = await setup(null);
    expect((await run(["cross-session", "--config", configPath])).code).toBe(2);
    expect((await run(["cross-session", "maybe", "--config", configPath])).code).toBe(2);
  });

  it("status prints the current value per Claude home", async () => {
    const { configPath } = await setup(JSON.stringify({ crossSessionInbound: "accept" }));
    expect((await run(["status", "--config", configPath])).out.join("\n")).toMatch(/crossSessionInbound .*: accept/);
    const none = await setup(null);
    expect((await run(["status", "--config", none.configPath])).out.join("\n")).toMatch(/crossSessionInbound .*: not set/);
  });
});
