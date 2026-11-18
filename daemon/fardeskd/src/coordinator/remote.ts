// A peer daemon over HTTP: bearer token, every response validated with the contract schemas.
import { z } from "zod";
import {
  activityPageSchema,
  errorResponseSchema,
  folderSearchSchema,
  messageRequestSchema,
  messageResultSchema,
  actionResultSchema,
  answerRequestSchema,
  killResultSchema,
  okResultSchema,
  permissionRequestSchema,
  sessionSummarySchema,
} from "../contract/schema.js";
import type { Peer } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { MachineEndpoint } from "./types.js";

const REQUEST_TIMEOUT_MS = 30_000;

type Call = { method: "GET" | "POST"; path: string; body?: unknown };

async function parseFailure(peer: Peer, response: Response): Promise<FardeskError> {
  const failure = errorResponseSchema.safeParse(await response.json().catch(() => null));
  const detail = failure.success ? failure.data.error.message : `HTTP ${response.status}`;
  return new FardeskError(failure.success ? failure.data.error.code : "internal", `peer ${peer.name}: ${detail}`);
}

async function request<S extends z.ZodType>(peer: Peer, token: string, call: Call, schema: S): Promise<z.infer<S>> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let response: Response;
  try {
    response = await fetch(`${peer.url.replace(/\/+$/, "")}${call.path}`, {
      method: call.method,
      redirect: "error",
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    });
  } catch (error) {
    throw new FardeskError("internal", `peer ${peer.name} is unreachable: ${error instanceof Error ? error.message : "request failed"}`);
  }
  if (!response.ok) throw await parseFailure(peer, response);
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new FardeskError("internal", `peer ${peer.name} answered ${call.path} with an unexpected body`);
  return parsed.data;
}

export function createRemoteEndpoint(peer: Peer, token: string): MachineEndpoint {
  const call = async <S extends z.ZodType>(spec: Call, schema: S): Promise<z.infer<S>> => request(peer, token, spec, schema);
  const sessionPath = (sessionId: string, action: string): string => `/v1/sessions/${encodeURIComponent(sessionId)}/${action}`;
  return {
    sessions: async () => call({ method: "GET", path: "/v1/sessions" }, z.array(sessionSummarySchema)),
    allSessions: async () => call({ method: "GET", path: "/v1/sessions?scope=all" }, z.array(sessionSummarySchema)),
    activity: async (sessionId, limit) => call({ method: "GET", path: `${sessionPath(sessionId, "activity")}?limit=${limit}` }, activityPageSchema),
    async message(sessionId, text): Promise<void> {
      await call({ method: "POST", path: sessionPath(sessionId, "message"), body: messageRequestSchema.parse({ text }) }, messageResultSchema);
    },
    folders: async (query, limit) => call({ method: "GET", path: `/v1/folders/search?q=${encodeURIComponent(query)}&limit=${limit}` }, folderSearchSchema),
    spawn: async (body) => (await call({ method: "POST", path: "/v1/sessions/new", body }, actionResultSchema)).sessionId,
    async stop(sessionId): Promise<void> {
      await call({ method: "POST", path: sessionPath(sessionId, "stop") }, okResultSchema);
    },
    async decide(sessionId, requestId, decision): Promise<void> {
      const body = permissionRequestSchema.parse({ decision });
      await call({ method: "POST", path: sessionPath(sessionId, `permission/${encodeURIComponent(requestId)}`), body }, okResultSchema);
    },
    async answer(sessionId, requestId, option): Promise<void> {
      const body = answerRequestSchema.parse({ option });
      await call({ method: "POST", path: sessionPath(sessionId, `answer/${encodeURIComponent(requestId)}`), body }, okResultSchema);
    },
    resume: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "resume") }, actionResultSchema)).sessionId,
    clear: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "clear") }, actionResultSchema)).sessionId,
    compact: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "compact") }, actionResultSchema)).sessionId,
    kill: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "kill"), body: { closeTab: false } }, killResultSchema)).closed,
  };
}
