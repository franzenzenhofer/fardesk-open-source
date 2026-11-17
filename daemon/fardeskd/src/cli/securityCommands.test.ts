import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { captureIo, writeCliConfig } from "../../test/support/cliConfig.js";
import { startTestDaemon, writeConfigFile, TEST_TOKEN } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { freePort } from "../../test/support/env.js";
import { AUDIT_FILE, createAuditLog } from "../audit/store.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { parseSince } from "./auditCommand.js";
import { runCli } from "./index.js";

const NOW = new Date("2026-11-17T12:00:00.000Z");
const homes: ClaudeHome[] = [];
let daemon: TestDaemon | null = null;

afterEach(async () => {
  for (const home of homes.splice(0)) home.dispose();
  await daemon?.close();
  daemon = null;
});

async function run(argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const io = captureIo({});
  const code = await runCli(argv, io, { createOwned: createRealOwned, now: () => NOW });
  return { code, out: io.out, err: io.err };
}

async function offlineConfig(): Promise<{ home: ClaudeHome; path: string; stateDir: string }> {
  const home = createClaudeHome();
  homes.push(home);
  return { home, ...writeCliConfig({ claudeHome: home.dir, port: await freePort() }) };
}

describe("rotate-token", () => {
  it("through the running daemon: new token in the config at mode 600, old token dead, hub renewal note printed", async () => {
    daemon = await startTestDaemon();
    const configPath = writeConfigFile(daemon.config);
    const result = await run(["rotate-token", "--config", configPath]);
    expect(result.code).toBe(0);
    const written = JSON.parse(readFileSync(configPath, "utf8")) as { token: string };
    expect(written.token).not.toBe(TEST_TOKEN);
    expect(statSync(configPath).mode & 0o777).toBe(0o600);
    expect((await daemon.call("GET", "/v1/machine", undefined, TEST_TOKEN)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/machine", undefined, written.token)).status).toBe(200);
    const text = result.out.join("\n");
    expect(text).toContain("hub links to renew");
    expect(text).toContain("test-mac");
    expect(text).not.toContain(written.token);
  });

  it("without a daemon: writes a new token to the config and says the next start uses it", async () => {
    const { path } = await offlineConfig();
    const result = await run(["rotate-token", "--config", path]);
    expect(result.code).toBe(0);
    expect(result.out.join("\n")).toContain("no daemon answers");
    const written = JSON.parse(readFileSync(path, "utf8")) as { token: string };
    expect(written.token).toMatch(/^[0-9a-f]{64}$/);
    expect(written.token).not.toBe(TEST_TOKEN);
  });
});

describe("audit command", () => {
  it("prints the log, filtered by --since", async () => {
    const { path, stateDir } = await offlineConfig();
    const log = createAuditLog({ stateDir, now: () => new Date("2026-11-17T09:00:00.000Z") });
    log.record({ event: "request", deviceId: "dev_1", method: "POST", route: "/v1/sessions/:id/message", sessionId: "s1", result: 200, ip: "100.64.0.9" });
    const later = createAuditLog({ stateDir, now: () => new Date("2026-11-17T11:45:00.000Z") });
    later.record({ event: "login_failed", deviceId: null, method: "POST", route: "/v1/auth/login", sessionId: null, result: 401, ip: "100.64.0.77" });
    const all = await run(["audit", "--config", path]);
    expect(all.out).toHaveLength(2);
    expect(all.out[0]).toContain("device=dev_1 POST /v1/sessions/:id/message session=s1 result=200");
    expect(all.out[1]).toContain("login_failed device=- POST /v1/auth/login session=- result=401 ip=100.64.0.77");
    expect((await run(["audit", "--since", "1h", "--config", path])).out).toHaveLength(1);
    expect((await run(["audit", "--since", "2026-11-17T09:00:00Z", "--config", path])).out).toHaveLength(2);
    expect((await run(["audit", "--since", "nonsense", "--config", path])).code).toBe(1);
    expect(existsSync(join(stateDir, AUDIT_FILE))).toBe(true);
  });

  it("parses spans", () => {
    expect(parseSince("30m", NOW).toISOString()).toBe("2026-11-17T11:30:00.000Z");
    expect(parseSince("2h", NOW).toISOString()).toBe("2026-11-17T10:00:00.000Z");
    expect(parseSince("7d", NOW).toISOString()).toBe("2026-11-10T12:00:00.000Z");
  });
});

describe("install-hooks consent", () => {
  it("--dry-run prints the diff and writes nothing: no settings file, no backup", async () => {
    const { home, path } = await offlineConfig();
    const settings = join(home.dir, "settings.json");
    writeFileSync(settings, JSON.stringify({ theme: "dark" }));
    const before = readFileSync(settings, "utf8");
    const result = await run(["install-hooks", "--dry-run", "--config", path]);
    expect(result.code).toBe(0);
    const text = result.out.join("\n");
    expect(text).toContain("dry run, install-hooks would change");
    expect(result.out.some((line) => line.startsWith("+ ") && line.includes("fardesk"))).toBe(true);
    expect(readFileSync(settings, "utf8")).toBe(before);
    expect(readdirSync(home.dir).filter((name) => name.includes("fardesk-bak"))).toEqual([]);
  });

  it("--dry-run on a missing settings file creates nothing", async () => {
    const { home, path } = await offlineConfig();
    const result = await run(["install-hooks", "--dry-run", "--config", path]);
    expect(result.code).toBe(0);
    expect(existsSync(join(home.dir, "settings.json"))).toBe(false);
  });

  it("--dry-run shows no change once the hooks are installed, and is refused for uninstall-hooks", async () => {
    const { path } = await offlineConfig();
    expect((await run(["install-hooks", "--config", path])).code).toBe(0);
    expect((await run(["install-hooks", "--dry-run", "--config", path])).out[0]).toContain("dry run, no change");
    const refused = await run(["uninstall-hooks", "--dry-run", "--config", path]);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain("only for install-hooks");
  });

  it("refuses to install while the state dir is readable by group or others, and names the fix", async () => {
    const { home, path, stateDir } = await offlineConfig();
    mkdirSync(stateDir, { recursive: true });
    chmodSync(stateDir, 0o755);
    const refused = await run(["install-hooks", "--config", path]);
    expect(refused.code).toBe(1);
    expect(refused.err.join("\n")).toContain(`chmod 700 ${stateDir}`);
    expect(existsSync(join(home.dir, "settings.json"))).toBe(false);
    chmodSync(stateDir, 0o700);
    expect((await run(["install-hooks", "--config", path])).code).toBe(0);
  });
});

describe("password minimum", () => {
  it("is 12 in set-password: 11 characters fail, 12 pass", async () => {
    const { path } = await offlineConfig();
    const io = (password: string): ReturnType<typeof captureIo> => captureIo({}, password);
    const short = io("a".repeat(11));
    expect(await runCli(["set-password", "--config", path], short, { createOwned: createRealOwned })).toBe(1);
    expect(short.err.join("\n")).toContain("at least 12 characters");
    const fine = io("a".repeat(12));
    expect(await runCli(["set-password", "--config", path], fine, { createOwned: createRealOwned })).toBe(0);
  });
});
