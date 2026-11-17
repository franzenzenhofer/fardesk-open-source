import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { fixturePath, makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { runHook } from "../../test/support/hookRun.js";
import { createLogger } from "../core/log.js";
import { buildHookCommand } from "./command.js";
import type { HookEvent } from "./payload.js";
import { createHookReceiver, MAX_BODY_BYTES } from "./receiver.js";
import type { HookReceiver, HookReply } from "./receiver.js";

const FAIL_OPEN_BUDGET_MS = 300;
const FAIL_OPEN_RUNS = 10;
const FIXTURE_NAMES = readdirSync(fixturePath("hooks")).filter((name) => name.endsWith(".json"));

const LISTEN_AND_WAIT = 'require("net").createServer().listen(process.argv[1], () => console.log("ready"))';

// A real stale socket: a process binds it and is SIGKILLed, so the socket inode stays without a listener.
async function leaveStaleSocket(socketPath: string): Promise<void> {
  const child = spawn(process.execPath, ["-e", LISTEN_AND_WAIT, socketPath], { stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve) => child.stdout.once("data", () => { resolve(); }));
  const exited = new Promise<void>((resolve) => child.once("close", () => { resolve(); }));
  child.kill("SIGKILL");
  await exited;
}

async function failOpenTimes(socketPath: string): Promise<number[]> {
  const times: number[] = [];
  for (let i = 0; i < FAIL_OPEN_RUNS; i += 1) {
    const run = await runHook(buildHookCommand(socketPath, 5), fixtureText("Stop.json"));
    expect(run).toMatchObject({ code: 0, stdout: "" });
    times.push(run.ms);
  }
  return times;
}

function fixtureText(name: string): string {
  return readFileSync(fixturePath("hooks", name), "utf8");
}

type Harness = {
  socketPath: string;
  events: HookEvent[];
  logs: string[];
  receiver: HookReceiver;
};

const open: HookReceiver[] = [];

async function startReceiver(
  onEvent: (event: HookEvent) => Promise<HookReply>,
  socketPath = join(makeTempDir(), "state", "hook.sock"),
): Promise<Harness> {
  const events: HookEvent[] = [];
  const logs: string[] = [];
  const log = createLogger((line) => logs.push(line), () => new Date("2026-11-15T12:00:00Z"));
  const receiver = await createHookReceiver({
    socketPath,
    log,
    onEvent: async (event) => {
      events.push(event);
      return onEvent(event);
    },
  });
  open.push(receiver);
  return { socketPath, events, logs, receiver };
}

afterEach(async () => {
  for (const receiver of open.splice(0)) await receiver.close();
});

const nullReply = (): Promise<HookReply> => Promise.resolve({ output: null });

function rawRequest(socketPath: string, method: string, path: string, body: Buffer | string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method, path }, (res) => {
      let text = "";
      res.on("data", (chunk: Buffer) => {
        text += chunk.toString("utf8");
      });
      res.on("end", () => {
        resolve({ status: res.statusCode ?? 0, body: text });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

describe("hook command against the receiver", () => {
  it.each(FIXTURE_NAMES)("delivers %s and prints nothing for a null reply", async (name) => {
    const { socketPath, events } = await startReceiver(nullReply);
    const run = await runHook(buildHookCommand(socketPath, 5), fixtureText(name));
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(events).toHaveLength(1);
    expect(events[0]?.raw).toEqual(JSON.parse(fixtureText(name)));
  });

  it("prints the JSON output of a reply on stdout", async () => {
    const output = { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
    const { socketPath, events } = await startReceiver(() => Promise.resolve({ output }));
    const run = await runHook(buildHookCommand(socketPath, 5), fixtureText("PermissionRequest-bash.json"));
    expect(run.code).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(output);
    expect(events[0]?.toolName).toBe("Bash");
  });

  it("fails open fast when the receiver is closed and the socket file is gone", async () => {
    const { socketPath, receiver } = await startReceiver(nullReply);
    await receiver.close();
    expect(existsSync(socketPath)).toBe(false);
    const times = await failOpenTimes(socketPath);
    console.log(`fail-open socket gone: max ${Math.max(...times).toFixed(1)} ms, times ${times.map((t) => t.toFixed(0)).join(",")}`);
    expect(Math.max(...times)).toBeLessThan(FAIL_OPEN_BUDGET_MS);
  });

  it("fails open fast with a stale socket file and no listener", async () => {
    const dir = makeTempDir();
    const socketPath = join(dir, "hook.sock");
    await leaveStaleSocket(socketPath);
    expect(statSync(socketPath).isSocket()).toBe(true);
    const times = await failOpenTimes(socketPath);
    console.log(`fail-open stale socket: max ${Math.max(...times).toFixed(1)} ms`);
    expect(Math.max(...times)).toBeLessThan(FAIL_OPEN_BUDGET_MS);
  });

  it("fails open with exit 0 when onEvent rejects, and logs the error", async () => {
    const { socketPath, logs } = await startReceiver(() => Promise.reject(new Error("boom")));
    const run = await runHook(buildHookCommand(socketPath, 5), fixtureText("PermissionRequest-bash.json"));
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(logs.map((line) => JSON.parse(line) as Record<string, string>)).toContainEqual(
      expect.objectContaining({ level: "error", msg: "hook_handler_failed", event: "PermissionRequest", error: "Error: boom" }),
    );
  });

  it("fails open when the curl timeout is shorter than a slow onEvent", async () => {
    const { socketPath } = await startReceiver(async () => {
      await sleep(1_500);
      return { output: { late: true } };
    });
    const run = await runHook(buildHookCommand(socketPath, 0.3), fixtureText("PermissionRequest-bash.json"));
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(run.ms).toBeLessThan(1_200);
  });

  it("answers an invalid JSON body with 400, empty stdout, exit 0 and no onEvent call", async () => {
    const { socketPath, events, logs } = await startReceiver(nullReply);
    const run = await runHook(buildHookCommand(socketPath, 5), "this is not json");
    expect(run).toMatchObject({ code: 0, stdout: "" });
    const wrongShape = await runHook(buildHookCommand(socketPath, 5), '{"hook_event_name":"Stop"}');
    expect(wrongShape).toMatchObject({ code: 0, stdout: "" });
    expect(events).toHaveLength(0);
    expect(logs.filter((line) => line.includes("hook_rejected"))).toHaveLength(2);
  });

  it("starts a second receiver on a stale socket path", async () => {
    const first = await startReceiver(nullReply);
    await first.receiver.close();
    await leaveStaleSocket(first.socketPath);
    const second = await startReceiver(nullReply, first.socketPath);
    const run = await runHook(buildHookCommand(second.socketPath, 5), fixtureText("Stop.json"));
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(second.events).toHaveLength(1);
  });
});

describe("receiver HTTP behaviour", () => {
  it("restricts the parent dir to 700 and the socket to 600", async () => {
    const { socketPath } = await startReceiver(nullReply);
    expect(statSync(socketPath).mode & 0o777).toBe(0o600);
    expect(statSync(join(socketPath, "..")).mode & 0o777).toBe(0o700);
  });

  it("answers 404 for other paths and methods without calling onEvent", async () => {
    const { socketPath, events } = await startReceiver(nullReply);
    expect((await rawRequest(socketPath, "GET", "/hook", "")).status).toBe(404);
    expect((await rawRequest(socketPath, "POST", "/other", "{}")).status).toBe(404);
    expect(events).toHaveLength(0);
  });

  it("answers 400 for a body above the limit and keeps serving", async () => {
    const { socketPath, events } = await startReceiver(nullReply);
    const big = Buffer.alloc(MAX_BODY_BYTES + 1, "a");
    const tooLarge = await rawRequest(socketPath, "POST", "/hook", big);
    expect(tooLarge).toEqual({ status: 400, body: "" });
    const ok = await rawRequest(socketPath, "POST", "/hook", fixtureText("Stop.json"));
    expect(ok.status).toBe(200);
    expect(events).toHaveLength(1);
  });

  it("survives a client that disconnects while the body is still arriving", async () => {
    const { socketPath, events } = await startReceiver(nullReply);
    const req = request({ socketPath, method: "POST", path: "/hook", headers: { "Content-Length": "1000" } });
    req.on("error", () => undefined);
    req.write("{");
    await sleep(50);
    req.destroy();
    await sleep(100);
    expect(events).toHaveLength(0);
    expect((await rawRequest(socketPath, "POST", "/hook", fixtureText("Stop.json"))).status).toBe(200);
  });

  it("survives a client that disconnects while onEvent is pending", async () => {
    let release: (reply: HookReply) => void = () => undefined;
    const pending = new Promise<HookReply>((resolve) => {
      release = resolve;
    });
    const { socketPath, events } = await startReceiver(() => pending);
    const req = request({ socketPath, method: "POST", path: "/hook" });
    req.on("error", () => undefined);
    req.end(fixtureText("PermissionRequest-bash.json"));
    await waitUntil(() => events.length === 1);
    req.destroy();
    await sleep(50);
    release({ output: { late: true } });
    await sleep(50);
    expect((await rawRequest(socketPath, "POST", "/hook", fixtureText("Stop.json"))).status).toBe(200);
  });

  it("close() destroys open connections and removes the socket file", async () => {
    const { socketPath, events, receiver } = await startReceiver(() => new Promise<HookReply>(() => undefined));
    const outcome = rawRequest(socketPath, "POST", "/hook", fixtureText("PermissionRequest-bash.json")).then(
      () => "answered",
      () => "dropped",
    );
    await waitUntil(() => events.length === 1);
    await receiver.close();
    expect(await outcome).toBe("dropped");
    expect(existsSync(socketPath)).toBe(false);
  });
});
