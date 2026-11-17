import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCommand } from "../config/bind.js";
import { FardeskError } from "../core/errors.js";
import { isProcessAlive } from "../sessions/processes.js";
import { makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { writeWrapper } from "../../test/support/terminals.js";
import { BUSY_CONFIRM_MS, confirmDelivery, waitForDelivery } from "./delivery.js";
import { INBOX_FROM_LABEL, postToInbox } from "./inbox.js";
import { sendEscape } from "./tmux.js";
import { terminate } from "./terminate.js";

// A private tmux server (-L fardesk-test-*): these tests never touch the tmux servers of the person running them.
const TMUX = writeWrapper().binary;
const POLL_MS = 10;

async function expectFardeskError(promise: Promise<unknown>, code: string, fragment: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(FardeskError);
  expect((error as FardeskError).code).toBe(code);
  expect((error as FardeskError).message).toContain(fragment);
}

describe("postToInbox", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const current = server;
    server = undefined;
    if (current !== undefined) {
      await new Promise<void>((resolve) => {
        current.close(() => {
          resolve();
        });
      });
    }
  });

  it("writes exactly one JSON line and ends the connection", async () => {
    const dir = makeTempDir();
    const socketPath = join(dir, "in.sock");
    const received: Buffer[] = [];
    let ended = false;
    server = createServer((socket: Socket) => {
      socket.on("data", (chunk: Buffer) => received.push(chunk));
      socket.on("end", () => {
        ended = true;
      });
    });
    await new Promise<void>((resolve) => server?.listen(socketPath, resolve));
    const text = 'line one\nline "two" \\ end';
    await postToInbox({ socketPath, text, from: INBOX_FROM_LABEL });
    await waitUntil(() => ended);
    const raw = Buffer.concat(received).toString("utf8");
    expect(raw).toBe(`{"type":"user","message":{"role":"user","content":${JSON.stringify(text)}},"from":"fardesk"}\n`);
    expect(raw.split("\n")).toHaveLength(2);
    expect(JSON.parse(raw) as unknown).toEqual({ type: "user", message: { role: "user", content: text }, from: "fardesk" });
  });

  it("fails as unsupported when the socket file is missing", async () => {
    const socketPath = join(makeTempDir(), "missing.sock");
    await expectFardeskError(postToInbox({ socketPath, text: "x", from: "f" }), "unsupported", "session inbox is not reachable");
  });

  it("fails as unsupported when the socket file is stale (no listener)", async () => {
    const dir = makeTempDir();
    const socketPath = join(dir, "stale.sock");
    const owner = spawn(process.execPath, ["-e", `require("node:net").createServer().listen(${JSON.stringify(socketPath)}, () => console.log("up"))`], { stdio: ["ignore", "pipe", "ignore"] });
    await new Promise((resolve) => owner.stdout.once("data", resolve));
    owner.kill("SIGKILL");
    await new Promise((resolve) => owner.once("exit", resolve));
    expect(existsSync(socketPath)).toBe(true);
    await expectFardeskError(postToInbox({ socketPath, text: "x", from: "f" }), "unsupported", "session inbox is not reachable");
  });
});

describe("waitForDelivery", () => {
  const user = (content: unknown): string => JSON.stringify({ type: "user", message: { content } });

  function fileReader(path: string): () => string[] {
    let offset = 0;
    return () => {
      const data = readFileSync(path, "utf8");
      const fresh = data.slice(offset);
      offset = data.length;
      return fresh.split("\n").filter((line) => line !== "");
    };
  }

  it("resolves true when a matching line is appended later (string and block content)", async () => {
    const file = join(makeTempDir(), "t.jsonl");
    writeFileSync(file, "");
    const reader = fileReader(file);
    setTimeout(() => {
      appendFileSync(file, `not json\n42\nnull\n${JSON.stringify({ type: "assistant", message: { content: "needle" } })}\n${user("other")}\n`);
    }, 20);
    setTimeout(() => {
      appendFileSync(file, `${user([{ type: "image" }, "str", null, { type: "text", text: "a needle b" }])}\n`);
    }, 60);
    expect(await waitForDelivery({ readLines: reader, text: "needle", timeoutMs: 2000, pollMs: POLL_MS })).toBe(true);
    const second = join(makeTempDir(), "t2.jsonl");
    writeFileSync(second, `${user("has needle inside")}\n`);
    expect(await waitForDelivery({ readLines: fileReader(second), text: "needle", timeoutMs: 500, pollMs: POLL_MS })).toBe(true);
  });

  it("resolves false on timeout when nothing matches", async () => {
    const lines = [user(["no-array-text"]), user({ weird: true }), user([{ type: "text", text: 5 }]), JSON.stringify({ type: "user" })];
    expect(await waitForDelivery({ readLines: () => lines, text: "needle", timeoutMs: 60, pollMs: POLL_MS })).toBe(false);
  });
});

describe("queue lines while the session is mid-turn (real Claude Code 2.1.325 shapes)", () => {
  const text = "Reply with only the word WALNUT";
  const enqueue = JSON.stringify({ type: "queue-operation", operation: "enqueue", timestamp: "2026-11-15T20:01:18.848Z", content: text });
  const remove = JSON.stringify({ type: "queue-operation", operation: "remove", content: text, reason: "absorbed_mid_turn" });
  const attachment = JSON.stringify({
    type: "attachment",
    attachment: { type: "queued_command", prompt: text, commandMode: "prompt", origin: { kind: "human" } },
  });
  const options = { text, timeoutMs: 60, pollMs: POLL_MS, sessionId: "s1" };

  it("is queued when only the enqueue line is there, even for an idle-looking session", async () => {
    expect(await confirmDelivery({ ...options, readLines: () => [enqueue], busy: false })).toBe("queued");
  });

  it("is delivered when the queued_command attachment shows the text", async () => {
    expect(await confirmDelivery({ ...options, readLines: () => [enqueue, remove, attachment], busy: false })).toBe("delivered");
  });

  it("answers queued within the short busy window, not after the full delivery timeout", async () => {
    const started = Date.now();
    const outcome = await confirmDelivery({ ...options, timeoutMs: 8_000, readLines: () => [], busy: true });
    expect(outcome).toBe("queued");
    expect(Date.now() - started).toBeLessThan(BUSY_CONFIRM_MS + 400);
  });

  it("ignores queue lines and attachments for other text", async () => {
    const other = enqueue.replace("WALNUT", "ACORN");
    const otherAttachment = attachment.replace("WALNUT", "ACORN");
    await expectFardeskError(confirmDelivery({ ...options, readLines: () => [other, otherAttachment], busy: false }), "unsupported", "did not take");
  });
});

describe("confirmDelivery over a real inbox socket", () => {
  let server: Server | undefined;

  afterEach(async () => {
    const current = server;
    server = undefined;
    if (current !== undefined) await new Promise<void>((resolve) => current.close(() => {
        resolve();
      }));
  });

  // An inbox that accepts the line and, when `transcribe` is set, writes it into the transcript at once.
  async function startInbox(transcript: string, transcribe: boolean): Promise<string> {
    const socketPath = join(makeTempDir(), "in.sock");
    server = createServer((socket: Socket) => {
      socket.on("data", () => {
        if (transcribe) appendFileSync(transcript, `${JSON.stringify({ type: "user", message: { content: "needle text" } })}\n`);
      });
    });
    await new Promise<void>((resolve) => server?.listen(socketPath, resolve));
    return socketPath;
  }

  async function send(busy: boolean, transcribe: boolean): Promise<"delivered" | "queued"> {
    const transcript = join(makeTempDir(), "t.jsonl");
    writeFileSync(transcript, "");
    const socketPath = await startInbox(transcript, transcribe);
    await postToInbox({ socketPath, text: "needle text", from: INBOX_FROM_LABEL });
    const readLines = (): string[] => readFileSync(transcript, "utf8").split("\n");
    return confirmDelivery({ readLines, text: "needle text", timeoutMs: 150, pollMs: POLL_MS, busy, sessionId: "s1" });
  }

  it("is delivered when the transcript shows the message, busy or not", async () => {
    expect(await send(false, true)).toBe("delivered");
  });

  it("is queued, not an error, when a busy session has not written it yet", async () => {
    expect(await send(true, false)).toBe("queued");
  });

  it("is still an error when an idle session does not take the message", async () => {
    await expectFardeskError(send(false, false), "unsupported", "did not take the message within 150 ms");
  });
});

describe("sendEscape (real tmux)", () => {
  const sessions: string[] = [];

  afterEach(async () => {
    for (const name of sessions.splice(0)) await runCommand(TMUX, ["kill-session", "-t", name]).catch(() => "");
  });

  async function startSession(): Promise<string> {
    const name = `fdtest-${Math.random().toString(36).slice(2, 10)}`;
    await runCommand(TMUX, ["new-session", "-d", "-s", name, "-c", makeTempDir(), "cat -v"]);
    sessions.push(name);
    return name;
  }

  async function paneText(name: string): Promise<string> {
    return runCommand(TMUX, ["capture-pane", "-p", "-t", name]);
  }

  it("sends Escape to the pane id and to the registry target format", async () => {
    const name = await startSession();
    const listed = (await runCommand(TMUX, ["list-panes", "-t", name, "-F", "#{session_name}:#{window_id}.#{pane_id}|#{pane_id}"])).trim();
    const [registry = "", paneId = ""] = listed.split("|");
    await sendEscape({ tmuxBinary: TMUX, pane: paneId, run: runCommand });
    await sleep(200);
    expect(await paneText(name)).toContain("^[");
    await sendEscape({ tmuxBinary: TMUX, pane: registry, run: runCommand });
    await sleep(200);
    expect((await paneText(name)).match(/\^\[/g)?.length).toBe(2);
  });

  it("fails as unsupported for an unknown pane", async () => {
    await expectFardeskError(sendEscape({ tmuxBinary: TMUX, pane: "fdtest-nonexistent:@0.%0", run: runCommand }), "unsupported", "is not reachable");
  });

  it("rejects an invalid pane before running anything", async () => {
    let ran = false;
    const run = (): Promise<string> => {
      ran = true;
      return Promise.resolve("");
    };
    await expectFardeskError(sendEscape({ tmuxBinary: TMUX, pane: "a b; rm", run }), "invalid_request", "invalid tmux pane");
    await expectFardeskError(sendEscape({ tmuxBinary: TMUX, pane: "-t", run }), "invalid_request", "invalid tmux pane");
    expect(ran).toBe(false);
  });
});

describe("terminate (real processes)", () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  function spawnNode(script: string): ChildProcess {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });
    children.push(child);
    return child;
  }

  it("returns when the process exits on SIGTERM", async () => {
    const child = spawnNode("setInterval(()=>{},1000)");
    const pid = child.pid ?? 0;
    await terminate({ pid, signal: "SIGTERM", timeoutMs: 5000, pollMs: POLL_MS, isAlive: (p) => isProcessAlive(p) && child.exitCode === null && child.signalCode === null });
    expect(child.signalCode).toBe("SIGTERM");
  });

  it("throws conflict when the process ignores the signal", async () => {
    const child = spawnNode("process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)");
    await sleep(300);
    const pid = child.pid ?? 0;
    await expectFardeskError(terminate({ pid, signal: "SIGTERM", timeoutMs: 100, pollMs: POLL_MS, isAlive: isProcessAlive }), "conflict", `process ${pid} did not exit`);
    expect(isProcessAlive(pid)).toBe(true);
  });

  it("resolves immediately for an already exited pid", async () => {
    const child = spawnNode("");
    await new Promise((resolve) => child.once("exit", resolve));
    const pid = child.pid ?? 0;
    await waitUntil(() => !isProcessAlive(pid));
    await terminate({ pid, signal: "SIGTERM", timeoutMs: 100, pollMs: POLL_MS, isAlive: isProcessAlive });
  });
});
