// The coordinator tools that inspect and steer other sessions: search, open requests, answers, resume/clear/compact/end.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { permissionDecisionSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { CoordinatorBackend } from "./types.js";
import { readImageFile } from "./imageFile.js";
import { answer, machine, sessionId } from "./toolKit.js";
import type { ToolFactory } from "./toolKit.js";
import { updateMachines } from "./toolsUpdate.js";

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
    "Answer an open request of a session, as the user would on the phone: for a permission request decision allow, deny or allow_always; for a plan request (pending_requests shows the plan) decision approve_bypass, approve_manual or revise, revise with message telling Claude what to change; for a question one of its options as option; for a Claude Code dialog one of its choices as answer.",
    { machine, sessionId, requestId: z.string().min(1), decision: permissionDecisionSchema.optional(), message: z.string().min(1).optional(), option: z.string().min(1).optional(), answer: z.string().min(1).optional() },
    async (args) =>
      answer(async () => {
        if (args.answer !== undefined) {
          await backend.answerDialog(args.machine, args.sessionId, args.requestId, args.answer);
          return `answered "${args.answer}"`;
        }
        if (args.decision !== undefined) {
          await backend.decidePermission(args.machine, args.sessionId, args.requestId, args.message === undefined ? { decision: args.decision } : { decision: args.decision, message: args.message });
          return `permission ${args.decision}`;
        }
        if (args.option === undefined) throw new FardeskError("invalid_request", "give decision (permission), option (question) or answer (dialog)");
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

const setSessionImage: ToolFactory = (backend) =>
  tool(
    "set_session_image",
    "Set the picture of a chat: the phone list shows it instead of the agent avatar. path is an absolute path of a JPEG or PNG file on THIS machine (an image you made or downloaded), at most 2 MB; scale a bigger one down first, e.g. `sips -Z 512 <file>` on macOS or ImageMagick `convert -resize 512x512 <file> <out>`. Works on a session of any machine.",
    { machine, sessionId, path: z.string().min(1).describe("Absolute path of the JPEG or PNG file") },
    async (args) => answer(async () => `image set (${await backend.setSessionImage(args.machine, args.sessionId, readImageFile(args.path))})`),
  );

const clearSessionImage: ToolFactory = (backend) =>
  tool(
    "clear_session_image",
    "Remove the picture of a chat: the phone list shows the agent avatar again.",
    { machine, sessionId },
    async (args) =>
      answer(async () => {
        await backend.clearSessionImage(args.machine, args.sessionId);
        return "image cleared";
      }),
  );

export const manageTools: ToolFactory[] = [searchSessions, pendingRequests, answerRequest, resumeSession, clearSession, compactSession, endSession, setSessionImage, clearSessionImage, updateMachines];
