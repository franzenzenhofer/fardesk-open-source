import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../test/support/claudeHome.js";
import { writeCliConfig } from "../test/support/cliConfig.js";
import { TEST_TOKEN } from "../test/support/daemon.js";
import { runMain } from "./cli/bin.js";
import { freePort, portAccepts, sleep, waitUntil } from "../test/support/env.js";

const MAIN = new URL("./main.ts", import.meta.url).pathname;
const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill("SIGKILL");
});

function start(args: string[]): { child: ChildProcess; stdout: () => string; stderr: () => string; exit: Promise<number | null> } {
  const child = spawn(process.execPath, ["--import", "tsx", MAIN, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk: Buffer) => { out += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { err += chunk.toString("utf8"); });
  const exit = new Promise<number | null>((resolve) => child.once("close", resolve));
  return { child, stdout: () => out, stderr: () => err, exit };
}

describe("main as a real process", () => {
  it("serves plain HTTP and stops cleanly on SIGTERM, releasing the port and the hook socket", async () => {
    const home = createClaudeHome();
    const port = await freePort();
    const { path, stateDir } = writeCliConfig({ claudeHome: home.dir, port });
    const run = start(["serve", "--config", path]);
    await waitUntil(() => run.stdout().includes("listening"), 20_000);
    const response = await fetch(`http://127.0.0.1:${port}/v1/machine`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    expect(response.status).toBe(200);
    expect(await portAccepts(port)).toBe(true);
    expect(existsSync(join(stateDir, "hook.sock"))).toBe(true);
    run.child.kill("SIGTERM");
    expect(await run.exit).toBe(0);
    expect(existsSync(join(stateDir, "hook.sock"))).toBe(false);
    expect(await portAccepts(port)).toBe(false);
    home.dispose();
  });

  it("stops cleanly on SIGINT too", async () => {
    const home = createClaudeHome();
    const { path } = writeCliConfig({ claudeHome: home.dir, port: await freePort() });
    const run = start(["serve", "--config", path]);
    await waitUntil(() => run.stdout().includes("listening"), 20_000);
    run.child.kill("SIGINT");
    expect(await run.exit).toBe(0);
    home.dispose();
  });

  it("exits 2 with usage for an unknown command and 0 for --help", async () => {
    const bad = start(["bogus"]);
    expect(await bad.exit).toBe(2);
    expect(bad.stderr()).toContain("usage: fardeskd");
    const help = start(["--help"]);
    expect(await help.exit).toBe(0);
    expect(help.stdout()).toContain("fardeskd <command>");
  });
});

describe("main in this process", () => {
  it("runs the CLI with the real argv and sets the exit code", async () => {
    const argv = process.argv;
    process.argv = [process.execPath, MAIN, "--help"];
    try {
      await import("./main.js");
      expect(process.exitCode).toBe(0);
    } finally {
      process.argv = argv;
      process.exitCode = undefined;
    }
  });

  it("serves until the process signal arrives", async () => {
    const home = createClaudeHome();
    const port = await freePort();
    const { path } = writeCliConfig({ claudeHome: home.dir, port });
    const signals = Object.assign(new EventEmitter(), { env: {} });
    const exit = runMain(["serve", "--config", path], signals);
    await waitUntil(() => signals.listenerCount("SIGTERM") === 1);
    await expect(portUp(port)).resolves.toBe(true);
    signals.emit("SIGTERM");
    expect(await exit).toBe(0);
    home.dispose();
  });
});

async function portUp(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await portAccepts(port)) return true;
    await sleep(25);
  }
  return false;
}
