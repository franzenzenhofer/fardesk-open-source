import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { pairAs } from "../../test/support/auth.js";
import { runCaptured as run, writeCliConfig } from "../../test/support/cliConfig.js";
import { startTestDaemon, writeConfigFile } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { freePort } from "../../test/support/env.js";
import { REGISTRY_FILE, createDeviceRegistry } from "../auth/deviceRegistry.js";

let daemon: TestDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

async function bootDaemon(): Promise<{ daemon: TestDaemon; configPath: string }> {
  daemon = await startTestDaemon();
  return { daemon, configPath: writeConfigFile(daemon.config) };
}

describe("devices and revoke through the running daemon", () => {
  it("lists devices as a table, revokes by name, by id and all", async () => {
    const { daemon: running, configPath } = await bootDaemon();
    const alpha = await pairAs(running, "Alpha");
    const beta = await pairAs(running, "Beta");
    await pairAs(running, "Gamma");
    const table = await run(["devices", "--config", configPath]);
    expect(table.code).toBe(0);
    expect(table.out[0]).toMatch(/^NAME\s+ID\s+CREATED\s+LAST SEEN\s+LAST IP\s+STATE$/);
    expect(table.out.slice(1).map((line) => line.split(/\s+/)[0])).toEqual(["Alpha", "Beta", "Gamma"]);
    expect(table.out[1]).toContain("127.0.0.1");
    expect(table.out[1]).toMatch(/active$/);
    expect((await run(["revoke", "alpha", "--config", configPath])).out[0]).toContain("revoked 1 device(s)");
    expect((await running.call("GET", "/v1/machine", undefined, alpha.token)).status).toBe(401);
    expect((await run(["revoke", beta.deviceId, "--config", configPath])).code).toBe(0);
    expect((await run(["revoke", "--all", "--config", configPath])).out[0]).toContain("revoked 1 device(s)");
    expect((await run(["devices", "--config", configPath])).out.slice(1).every((line) => line.endsWith("revoked"))).toBe(true);
  });

  it("needs exactly one of a device or --all, and reports an unknown device", async () => {
    const { configPath } = await bootDaemon();
    expect((await run(["revoke", "--config", configPath])).code).toBe(2);
    expect((await run(["revoke", "x", "--all", "--config", configPath])).code).toBe(2);
    const missing = await run(["revoke", "nobody", "--config", configPath]);
    expect(missing.code).toBe(1);
    expect(missing.err.join("\n")).toContain("404");
  });
});

describe("devices and revoke without a daemon", () => {
  it("read and edit the registry file and say so", async () => {
    const home = createClaudeHome();
    const { path, stateDir } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const open = (): ReturnType<typeof createDeviceRegistry> => createDeviceRegistry({ path: join(stateDir, REGISTRY_FILE), now: () => new Date() });
    open().issue("Phone", "1.1.1.1", { stableId: "node-a", tags: [] });
    const listed = await run(["devices", "--config", path]);
    expect(listed.out[0]).toContain("no daemon answers");
    expect(listed.out[2]).toMatch(/^Phone\s/);
    const revoked = await run(["revoke", "phone", "--config", path]);
    expect(revoked.out[0]).toContain("revoked 1 device(s) in the registry file (no wipe push sent)");
    expect(open().list(null)[0]?.revoked).toBe(true);
    expect((await run(["revoke", "phone", "--config", path])).code).toBe(1);
    home.dispose();
  });

  it("has no command to set a password any more", async () => {
    const removed = ["set", "password"].join("-");
    const result = await run([removed]);
    expect(result.code).toBe(2);
    expect(result.err.join("\n")).toContain(`unknown command: ${removed}`);
  });
});
