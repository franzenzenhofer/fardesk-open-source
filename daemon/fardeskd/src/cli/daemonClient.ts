// Calls the running daemon of this machine's config with the master token. Every failure says why: an unreachable
// daemon is the typed "offline" answer (callers may fall back to the files), everything else throws with its reason.
import type { z } from "zod";
import { resolveBindAddress } from "../config/bind.js";
import { loadConfig } from "../config/config.js";
import { errorResponseSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { daemonUrl } from "../pairing/index.js";
import type { CommandContext } from "./types.js";

const REQUEST_TIMEOUT_MS = 15_000;
const RESTART_WAIT_MS = 4_000;
const RESTART_RETRY_MS = 250;
const NO_DAEMON = "no daemon answers";

/** `answered`: the daemon's reply. `offline`: nothing to talk to (daemon not running, Tailscale down), with the reason. */
export type DaemonAnswer<T> = { kind: "answered"; value: T } | { kind: "offline"; reason: string };

export type DaemonRequest = { method: "GET" | "POST"; path: string; body?: unknown };

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const causeOf = (error: unknown): { code?: string; message?: string } =>
  ((error as { cause?: { code?: string; message?: string } }).cause ?? {});

async function lookupUrl(context: CommandContext): Promise<{ url: string } | { reason: string }> {
  const config = loadConfig(context.configPath);
  try {
    return { url: daemonUrl(config, await resolveBindAddress(config, context.run, context.tailscaleCommands)) };
  } catch (error) {
    if (error instanceof FardeskError && error.code === "invalid_request") throw error;
    return { reason: `${NO_DAEMON}: the tailnet address of this computer could not be found, is Tailscale running? (${(error as Error).message})` };
  }
}

async function send(context: CommandContext, url: string, request: DaemonRequest): Promise<Response> {
  const timeoutMs = context.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  return fetch(`${url}${request.path}`, {
    method: request.method,
    headers: { authorization: `Bearer ${loadConfig(context.configPath).token}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });
}

/** A refused connection right after a restart is retried for a few seconds, and says so. */
async function sendWaitingForRestart(context: CommandContext, url: string, request: DaemonRequest): Promise<Response | { reason: string }> {
  const waitMs = context.deps.restartWaitMs ?? RESTART_WAIT_MS;
  const giveUpAt = Date.now() + waitMs;
  let announced = false;
  for (;;) {
    try {
      return await send(context, url, request);
    } catch (error) {
      const name = (error as Error).name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new FardeskError("machine_offline", `the daemon at ${url} did not answer within ${(context.deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS) / 1000} s: it is busy or restarting`);
      }
      const cause = causeOf(error);
      if (cause.code !== "ECONNREFUSED") throw new FardeskError("machine_offline", `could not reach the daemon at ${url}: ${cause.message ?? (error as Error).message}`);
      if (Date.now() >= giveUpAt) return { reason: `${NO_DAEMON}: fardeskd is not running (connection refused at ${url}), start it with fardeskd` };
      if (!announced) context.io.stderr(`connection refused at ${url}: the daemon may be restarting, waiting up to ${waitMs / 1000} s`);
      announced = true;
      await sleep(RESTART_RETRY_MS);
    }
  }
}

async function parseAnswer<S extends z.ZodType>(response: Response, schema: S): Promise<z.infer<S>> {
  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return schema.parse(json);
  const failure = errorResponseSchema.safeParse(json);
  const detail = failure.success ? ` (${failure.data.error.code}): ${failure.data.error.message}` : "";
  throw new FardeskError(failure.success ? failure.data.error.code : "internal", `daemon answered HTTP ${response.status}${detail}`);
}

export async function callDaemon<S extends z.ZodType>(context: CommandContext, request: DaemonRequest, schema: S): Promise<DaemonAnswer<z.infer<S>>> {
  const target = await lookupUrl(context);
  if ("reason" in target) return { kind: "offline", reason: target.reason };
  const response = await sendWaitingForRestart(context, target.url, request);
  if ("reason" in response) return { kind: "offline", reason: response.reason };
  return { kind: "answered", value: await parseAnswer(response, schema) };
}
