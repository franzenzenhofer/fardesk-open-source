import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { dirname } from "node:path";
import type { Logger } from "../core/log.js";
import { parseHookPayload } from "./payload.js";
import type { HookEvent } from "./payload.js";

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SOCKET_MODE = 0o600;
const DIR_MODE = 0o700;
const HOOK_PATH = "/hook";

export type HookReply = { output: Record<string, unknown> | null };

export type HookReceiverDeps = {
  socketPath: string;
  /** `signal` aborts when the hook's connection closes before the reply (its curl was killed: the dialog was answered elsewhere). */
  onEvent(event: HookEvent, signal: AbortSignal): Promise<HookReply>;
  log: Logger;
};

export type HookReceiver = { close(): Promise<void> };

type ReadResult = { ok: true; body: string } | { ok: false };

async function readBody(req: IncomingMessage): Promise<ReadResult> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk as Buffer);
    }
  } catch {
    return { ok: false };
  }
  return size > MAX_BODY_BYTES ? { ok: false } : { ok: true, body: Buffer.concat(chunks).toString("utf8") };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function respond(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, body === "" ? {} : { "Content-Type": "application/json" });
  res.end(body);
}

async function handleHook(req: IncomingMessage, res: ServerResponse, deps: HookReceiverDeps): Promise<void> {
  const read = await readBody(req);
  const parsed = read.ok ? parseHookPayload(parseJson(read.body)) : { ok: false as const, error: "unreadable body" };
  if (!parsed.ok) {
    deps.log.warn("hook_rejected", { error: parsed.error });
    respond(res, 400, "");
    return;
  }
  const closed = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) closed.abort();
  });
  try {
    const reply = await deps.onEvent(parsed.event, closed.signal);
    respond(res, 200, reply.output === null ? "" : JSON.stringify(reply.output));
  } catch (error) {
    deps.log.error("hook_handler_failed", { event: parsed.event.hookEventName, error: String(error) });
    respond(res, 500, "");
  }
}

function route(deps: HookReceiverDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    if (req.method !== "POST" || req.url !== HOOK_PATH) {
      req.resume();
      respond(res, 404, "");
      return;
    }
    void handleHook(req, res, deps);
  };
}

async function listen(server: Server, socketPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export async function createHookReceiver(deps: HookReceiverDeps): Promise<HookReceiver> {
  const { socketPath } = deps;
  mkdirSync(dirname(socketPath), { recursive: true, mode: DIR_MODE });
  chmodSync(dirname(socketPath), DIR_MODE);
  rmSync(socketPath, { force: true });
  const server = createServer(route(deps));
  await listen(server, socketPath);
  chmodSync(socketPath, SOCKET_MODE);
  deps.log.info("hook_receiver_listening", { socketPath });
  return {
    close: async (): Promise<void> => {
      const closed = new Promise<void>((resolve) => server.close(() => { resolve(); }));
      server.closeAllConnections();
      await closed;
      rmSync(socketPath, { force: true });
    },
  };
}
