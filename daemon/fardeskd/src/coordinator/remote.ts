// A peer daemon over plain HTTP on the tailnet: bearer token, every response validated with the contract schemas.
import { z } from "zod";
import {
  activityPageSchema,
  errorResponseSchema,
  folderSearchSchema,
  messageRequestSchema,
  messageResultSchema,
  actionResultSchema,
  answerRequestSchema,
  dialogAnswerRequestSchema,
  killResultSchema,
  imageResultSchema,
  okResultSchema,
  permissionRequestSchema,
  sessionSummarySchema,
} from "../contract/schema.js";
import type { Peer } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { MachineEndpoint, UpdateKeys } from "./types.js";

export const REQUEST_TIMEOUT_MS = 30_000;

/** body = JSON; raw = the bytes of a file with their own content type. */
type Call = { method: "GET" | "POST"; path: string; body?: unknown; raw?: { mediaType: string; bytes: Uint8Array } };

export async function parseFailure(peer: Peer, response: Response): Promise<FardeskError> {
  const failure = errorResponseSchema.safeParse(await response.json().catch(() => null));
  const detail = failure.success ? failure.data.error.message : `HTTP ${response.status}`;
  return new FardeskError(failure.success ? failure.data.error.code : "internal", `peer ${peer.name}: ${detail}`);
}

/** One HTTP call to a peer: a refused connection or an error answer becomes a FardeskError that names the peer. */
export async function fetchPeer(peer: Peer, path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${peer.url.replace(/\/+$/, "")}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw new FardeskError("internal", `peer ${peer.name} is unreachable: ${error instanceof Error ? error.message : "request failed"}`);
  }
  if (!response.ok) throw await parseFailure(peer, response);
  return response;
}

export async function request<S extends z.ZodType>(peer: Peer, token: string, call: Call, schema: S): Promise<z.infer<S>> {
  const headers = { authorization: `Bearer ${token}`, "content-type": call.raw?.mediaType ?? "application/json" };
  const body = call.raw === undefined ? (call.body === undefined ? undefined : JSON.stringify(call.body)) : call.raw.bytes;
  const response = await fetchPeer(peer, call.path, { method: call.method, headers, ...(body === undefined ? {} : { body }) });
  const parsed = schema.safeParse(await response.json());
  if (!parsed.success) throw new FardeskError("internal", `peer ${peer.name} answered ${call.path} with an unexpected body`);
  return parsed.data;
}

/** The chat image calls: the picture goes up as raw bytes with its own content type. */
function imageCalls(peer: Peer, token: string): Pick<MachineEndpoint, "setImage" | "clearImage"> {
  const path = (sessionId: string, action: string): string => `/v1/sessions/${encodeURIComponent(sessionId)}/${action}`;
  return {
    setImage: async (sessionId, image) => (await request(peer, token, { method: "POST", path: path(sessionId, "image"), raw: image }, imageResultSchema)).image,
    async clearImage(sessionId): Promise<void> {
      await request(peer, token, { method: "POST", path: path(sessionId, "image/clear") }, okResultSchema);
    },
  };
}

type Caller = <S extends z.ZodType>(spec: Call, schema: S) => Promise<z.infer<S>>;

/** The calls that answer what a session waits for: a permission request, a question, a Claude Code dialog. */
function answerCalls(call: Caller, sessionPath: (sessionId: string, action: string) => string): Pick<MachineEndpoint, "decide" | "answer" | "answerDialog"> {
  const post = async (sessionId: string, action: string, requestId: string, body: unknown): Promise<void> => {
    await call({ method: "POST", path: sessionPath(sessionId, `${action}/${encodeURIComponent(requestId)}`), body }, okResultSchema);
  };
  return {
    decide: async (sessionId, requestId, decision, message) =>
      post(sessionId, "permission", requestId, permissionRequestSchema.parse(message === undefined ? { decision } : { decision, message })),
    answer: async (sessionId, requestId, option) => post(sessionId, "answer", requestId, answerRequestSchema.parse({ option })),
    answerDialog: async (sessionId, requestId, answer) => post(sessionId, "dialog", requestId, dialogAnswerRequestSchema.parse({ answer })),
  };
}

export function createSessionEndpoint(peer: Peer, token: string): Omit<MachineEndpoint, UpdateKeys> {
  const call = async <S extends z.ZodType>(spec: Call, schema: S): Promise<z.infer<S>> => request(peer, token, spec, schema);
  const sessionPath = (sessionId: string, action: string): string => `/v1/sessions/${encodeURIComponent(sessionId)}/${action}`;
  return {
    ...imageCalls(peer, token),
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
    ...answerCalls(call, sessionPath),
    resume: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "resume") }, actionResultSchema)).sessionId,
    clear: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "clear") }, actionResultSchema)).sessionId,
    compact: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "compact") }, actionResultSchema)).sessionId,
    kill: async (sessionId) => (await call({ method: "POST", path: sessionPath(sessionId, "kill"), body: { closeTab: false } }, killResultSchema)).closed,
  };
}
