import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { OTHER_PASSWORD, TEST_PASSWORD, authOverrides, loginAs } from "../../test/support/auth.js";
import { captureIo, writeCliConfig } from "../../test/support/cliConfig.js";
import { startTestDaemon, writeConfigFile } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { freePort } from "../../test/support/env.js";
import { REGISTRY_FILE, createDeviceRegistry } from "../auth/deviceRegistry.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";
import { readPasswordInput } from "./passwordInput.js";

const MAIN = new URL("../main.ts", import.meta.url).pathname;
let daemon: TestDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

async function run(argv: string[], password = ""): Promise<{ code: number; out: string[]; err: string[] }> {
  const io = captureIo({}, password);
  const code = await runCli(argv, io, { createOwned: createRealOwned });
  return { code, out: io.out, err: io.err };
}

type Child = { code: number | null; stdout: string; stderr: string };

async function runChild(args: string[], stdin: string): Promise<Child> {
  const child = spawn(process.execPath, ["--import", "tsx", MAIN, ...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  child.stdin.end(stdin);
  const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
  return { code, stdout, stderr };
}

async function bootDaemon(): Promise<{ daemon: TestDaemon; configPath: string }> {
  daemon = await startTestDaemon(await authOverrides());
  return { daemon, configPath: writeConfigFile(daemon.config) };
}

describe("set-password as a real child process with piped stdin", () => {
  it("writes a hash, tells the running daemon, which revokes every token and takes the new password at once", async () => {
    const { daemon: running, configPath } = await bootDaemon();
    const { token } = await loginAs(running, "Phone");
    const child = await runChild(["set-password", "--config", configPath], `${OTHER_PASSWORD}\n`);
    expect(child.code).toBe(0);
    expect(child.stdout).toContain("running daemon reloaded");
    expect(`${child.stdout}${child.stderr}`).not.toContain(OTHER_PASSWORD);
    expect((await running.call("GET", "/v1/machine", undefined, token)).status).toBe(401);
    expect((await running.call("POST", "/v1/auth/login", { password: TEST_PASSWORD, deviceName: "x" }, null)).status).toBe(401);
    expect((await running.call("POST", "/v1/auth/login", { password: OTHER_PASSWORD, deviceName: "x" }, null)).status).toBe(200);
    const config = readFileSync(configPath, "utf8");
    expect(config).not.toContain(OTHER_PASSWORD);
    expect(config).toContain("scrypt$32768$8$1$");
  });

  it("without a running daemon it updates the config and revokes the tokens in the registry file", async () => {
    const home = createClaudeHome();
    const { path, stateDir } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const registry = createDeviceRegistry({ path: join(stateDir, REGISTRY_FILE), now: () => new Date() });
    const { token } = registry.issue("Phone", "1.1.1.1");
    const child = await runChild(["set-password", "--config", path], `${TEST_PASSWORD}\r\n`);
    expect(child.code).toBe(0);
    expect(child.stdout).toContain("no daemon answers, revoked 1 device token(s)");
    expect(createDeviceRegistry({ path: join(stateDir, REGISTRY_FILE), now: () => new Date() }).authenticate(token, "1.1.1.1")).toEqual({ state: "revoked" });
    const config = JSON.parse(readFileSync(path, "utf8")) as { auth: { passwordHash: string }; name: string; token: string };
    expect(config.auth.passwordHash.startsWith("scrypt$")).toBe(true);
    expect([config.name, config.token.length]).toEqual(["cli-box", 48]);
    home.dispose();
  });

  it("fails on empty stdin and on a password shorter than the minimum, leaving the config alone", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const before = readFileSync(path, "utf8");
    expect((await runChild(["set-password", "--config", path], "")).code).toBe(1);
    const short = await runChild(["set-password", "--config", path], "short\n");
    expect(short.code).toBe(1);
    expect(short.stderr).toContain("at least 12 characters");
    expect(short.stderr).not.toContain("short\n");
    expect(readFileSync(path, "utf8")).toBe(before);
    home.dispose();
  });
});

describe("devices and revoke through the running daemon", () => {
  it("lists devices as a table, revokes by name, by id and all", async () => {
    const { daemon: running, configPath } = await bootDaemon();
    const alpha = await loginAs(running, "Alpha");
    const beta = await loginAs(running, "Beta");
    await loginAs(running, "Gamma");
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
    open().issue("Phone", "1.1.1.1");
    const listed = await run(["devices", "--config", path]);
    expect(listed.out[0]).toContain("no daemon answers");
    expect(listed.out[2]).toMatch(/^Phone\s/);
    const revoked = await run(["revoke", "phone", "--config", path]);
    expect(revoked.out[0]).toContain("revoked 1 device(s) in the registry file (no wipe push sent)");
    expect(open().list(null)[0]?.revoked).toBe(true);
    expect((await run(["revoke", "phone", "--config", path])).code).toBe(1);
    home.dispose();
  });

  it("set-password through the CLI entry also rejects a short password", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const result = await run(["set-password", "--config", path], "short");
    expect(result.code).toBe(1);
    expect(result.err.join("\n")).toContain("at least 12 characters");
    home.dispose();
  });
});

describe("readPasswordInput", () => {
  it("reads one line when piped", async () => {
    const stdin = new PassThrough();
    stdin.end("first line\nsecond line\n");
    expect(await readPasswordInput(stdin as unknown as NodeJS.ReadStream, new PassThrough())).toBe("first line");
  });

  it("prompts twice on a terminal without echoing the password and rejects a mismatch", async () => {
    const terminal = (): PassThrough => Object.assign(new PassThrough(), { isTTY: true, setRawMode: (): void => undefined });
    const answer = async (lines: string[]): Promise<{ result: Promise<string>; prompts: () => string }> => {
      const stdin = terminal();
      const stderr = new PassThrough();
      let shown = "";
      stderr.on("data", (chunk: Buffer) => { shown += chunk.toString("utf8"); });
      const result = readPasswordInput(stdin as unknown as NodeJS.ReadStream, stderr);
      for (const line of lines) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        stdin.write(`${line}\n`);
      }
      return { result, prompts: () => shown };
    };
    const matching = await answer(["a long secret", "a long secret"]);
    expect(await matching.result).toBe("a long secret");
    expect(matching.prompts()).toContain("New password: ");
    expect(matching.prompts()).toContain("Repeat: ");
    expect(matching.prompts()).not.toContain("a long secret");
    await expect((await answer(["a long secret", "another one"])).result).rejects.toThrow("do not match");
  });

  it("fails on an empty pipe", async () => {
    const stdin = new PassThrough();
    stdin.end();
    await expect(readPasswordInput(stdin as unknown as NodeJS.ReadStream, new PassThrough())).rejects.toThrow("no password");
  });
});
