// The coordinator tools that inspect and steer other sessions: search, open requests, answers, resume/clear/compact/end.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { permissionDecisionSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { CoordinatorBackend } from "./types.js";
import { answer, machine, sessionId } from "./toolKit.js";
import type { ToolFactory } from "./toolKit.js";

const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 100;

const searchSessions: ToolFactory = (backend) =>
  tool(
    "search_sessions",
    "Search ALL sessions of every machine, also old ended ones the phone no longer lists, by text in title, folder (cwd) or summary, case-insensitive, newest first. Use it when the user asks for a session he cannot find.",
    {
      text: z.string().min(1),
      machine: z.string().min(1).optional().describe("Only this machine"),
      limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).default(DEFAULT_SEARCH_LIMIT),
    },
    async (args) => answer(async () => JSON.stringify(await backend.searchSessions({ text: args.text, machine: args.machine ?? null, limit: args.limit }))),
  );

const pendingRequests: ToolFactory = (backend) =>
  tool(
    "pending_requests",
    "What sessions are waiting for: their open permission requests (a tool call they want to run) and questions, with requestId, the text and the possible answers. Give machine and sessionId for one session, only machine for every waiting session there, or nothing for every waiting session on all machines.",
    { machine: z.string().min(1).optional(), sessionId: z.string().min(1).optional() },
    async (args) =>
      answer(async () => {
        const requests = await backend.pendingRequests({ machine: args.machine ?? null, sessionId: args.sessionId ?? null });
        return requests.length === 0 ? "no open requests" : JSON.stringify(requests);
      }),
  );

const answerRequest: ToolFactory = (backend) =>
  tool(
    "answer_request",
    "Answer an open request of a session, as the user would on the phone: for a permission request decision allow, deny or allow_always; for a question one of its options as option.",
    { machine, sessionId, requestId: z.string().min(1), decision: permissionDecisionSchema.optional(), option: z.string().min(1).optional() },
    async (args) =>
      answer(async () => {
        if (args.decision !== undefined) {
          await backend.decidePermission(args.machine, args.sessionId, args.requestId, args.decision);
          return `permission ${args.decision}`;
        }
        if (args.option === undefined) throw new FardeskError("invalid_request", "give decision (permission) or option (question)");
        await backend.answerQuestion(args.machine, args.sessionId, args.requestId, args.option);
        return `answered "${args.option}"`;
      }),
  );

type Move = (backend: CoordinatorBackend, machine: string, sessionId: string) => Promise<string>;

function moveTool(name: string, description: string, move: Move, verb: string): ToolFactory {
  return (backend) =>
    tool(name, description, { machine, sessionId }, async (args) => answer(async () => `${verb} - session ${await move(backend, args.machine, args.sessionId)}`));
}

const resumeSession = moveTool(
  "resume_session",
  "Continue an ended or idle session on its machine in its last permission mode. Returns the session id that continues.",
  async (backend, on, id) => backend.resumeSession(on, id),
  "resumed",
);
const clearSession = moveTool(
  "clear_session",
  "Run /clear on a session: a fresh conversation in the same folder (saves tokens). Returns the new session id.",
  async (backend, on, id) => backend.clearSession(on, id),
  "cleared",
);
const compactSession = moveTool(
  "compact_session",
  "Run /compact on a session: Claude summarises the conversation and continues from the summary.",
  async (backend, on, id) => backend.compactSession(on, id),
  "compacting",
);
const endSession = moveTool(
  "end_session",
  "End a session's process for good (it can be resumed later). Only when the user asks to end, kill or close it.",
  async (backend, on, id) => backend.endSession(on, id),
  "ended",
);

export const manageTools: ToolFactory[] = [searchSessions, pendingRequests, answerRequest, resumeSession, clearSession, compactSession, endSession];
