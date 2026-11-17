// Calls the running daemon of this machine's config with the master token (null when no daemon answers).
import type { z } from "zod";
import { resolveBindAddress } from "../config/bind.js";
import { loadConfig } from "../config/config.js";
import { errorResponseSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { daemonUrl } from "../pairing/index.js";
import type { CommandContext } from "./types.js";

const REQUEST_TIMEOUT_MS = 15_000;

async function baseUrl(context: CommandContext): Promise<string | null> {
  const config = loadConfig(context.configPath);
  try {
    return daemonUrl(config, await resolveBindAddress(config, context.run));
  } catch {
    return null;
  }
}

export async function callDaemon<S extends z.ZodType>(
  context: CommandContext,
  request: { method: "GET" | "POST"; path: string; body?: unknown },
  schema: S,
): Promise<z.infer<S> | null> {
  const url = await baseUrl(context);
  if (url === null) return null;
  const headers = { authorization: `Bearer ${loadConfig(context.configPath).token}`, "content-type": "application/json" };
  let response: Response;
  try {
    response = await fetch(`${url}${request.path}`, {
      method: request.method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });
  } catch {
    return null;
  }
  const json: unknown = await response.json();
  if (!response.ok) {
    const failure = errorResponseSchema.safeParse(json);
    throw new FardeskError(failure.success ? failure.data.error.code : "internal", `daemon answered HTTP ${response.status}${failure.success ? `: ${failure.data.error.message}` : ""}`);
  }
  return schema.parse(json);
}
