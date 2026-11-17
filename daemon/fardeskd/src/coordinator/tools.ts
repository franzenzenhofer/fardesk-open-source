// The coordinator tools as an in-process MCP server. Each one is a thin call into the backend.
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { DEFAULT_FOLDER_LIMIT, DEFAULT_SCAN_ROOTS, MAX_FOLDER_LIMIT, describeScanRoots } from "../folders/search.js";
import { answer, machine, sessionId } from "./toolKit.js";
import type { ToolFactory, ToolList } from "./toolKit.js";
import { manageTools } from "./toolsManage.js";
import type { CoordinatorBackend } from "./types.js";

export const COORDINATOR_SERVER_NAME = "fardesk";
const DEFAULT_ACTIVITY_LIMIT = 20;
const MAX_ACTIVITY_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 30;
const MAX_LIST_LIMIT = 200;
const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 300;

const listSessions: ToolFactory = (backend) =>
  tool(
    "list_sessions",
    "List Claude Code sessions of this machine and every linked machine as compact rows (machine, id, title, status, waitingFor, summary, updatedAt), waiting first, then working, idle, ended, newest first. The answer also gives each machine's total session count (count), whether it is linked or reachable, and how many rows matched (matching) when more than limit match.",
    {
      machine: z.string().min(1).optional().describe("Only this machine"),
      status: z.enum(["working", "waiting", "idle", "ended"]).optional(),
      limit: z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT),
    },
    async (args) => answer(async () => JSON.stringify(await backend.listSessions({ machine: args.machine ?? null, status: args.status ?? null, limit: args.limit }))),
  );

const readActivity: ToolFactory = (backend) =>
  tool(
    "read_activity",
    "Read the last activity rows of one session as short text lines, oldest first.",
    { machine, sessionId, limit: z.number().int().min(1).max(MAX_ACTIVITY_LIMIT).default(DEFAULT_ACTIVITY_LIMIT) },
    async (args) => answer(async () => (await backend.readActivity(args.machine, args.sessionId, args.limit)).join("\n")),
  );

const sendMessage: ToolFactory = (backend) =>
  tool(
    "send_message",
    "Send a prompt to a session as if the user typed it. Only sessions that take messages (owned by Fardesk or in a terminal that accepts them) can be reached.",
    { machine, sessionId, text: z.string().min(1) },
    async (args) =>
      answer(async () => {
        await backend.sendMessage(args.machine, args.sessionId, args.text);
        return "sent";
      }),
  );

const spawnSession: ToolFactory = (backend) =>
  tool(
    "spawn_session",
    "Start a new Claude Code session in a folder on a machine. Returns the new session id.",
    { machine, cwd: z.string().min(1), prompt: z.string().min(1), model: z.string().min(1).optional(), worktree: z.boolean().optional() },
    async (args) =>
      answer(async () => {
        const request = { cwd: args.cwd, prompt: args.prompt, model: args.model ?? null, worktree: args.worktree ?? false };
        return `started session ${await backend.spawnSession(args.machine, request)}`;
      }),
  );

const stopSession: ToolFactory = (backend) =>
  tool(
    "stop_session",
    "Interrupt the turn a session is currently running. The session stays open and can be messaged again.",
    { machine, sessionId },
    async (args) =>
      answer(async () => {
        await backend.stopSession(args.machine, args.sessionId);
        return "stopped";
      }),
  );

const findFolders: ToolFactory = (backend) =>
  tool(
    "find_folders",
    `Find folders on a machine whose name contains the query (case-insensitive): recently used folders first, then git repos and folders under the machine's scan roots (folders.scanRoots in its config.json; default: ${describeScanRoots(DEFAULT_SCAN_ROOTS)}). Returns one path per line, marked recent when it was used lately. Use it to resolve a loosely named folder before spawn_session.`,
    {
      machine,
      query: z.string().min(1),
      limit: z.number().int().min(1).max(MAX_FOLDER_LIMIT).default(DEFAULT_FOLDER_LIMIT),
    },
    async (args) =>
      answer(async () => {
        const { folders } = await backend.findFolders(args.machine, args.query, args.limit);
        if (folders.length === 0) return `no folder on ${args.machine} matches "${args.query}"`;
        return folders.map((folder) => (folder.recent ? `${folder.path} (recent)` : folder.path)).join("\n");
      }),
  );

const notifyPhone: ToolFactory = (backend) =>
  tool(
    "notify_phone",
    "Send a push notification to the owner's phone(s) registered on this daemon. Tapping it opens this coordinator session.",
    { title: z.string().min(1).max(MAX_TITLE_CHARS), body: z.string().min(1).max(MAX_BODY_CHARS) },
    async (args) => answer(async () => `sent to ${await backend.notifyPhone(args.title, args.body)} devices`),
  );

export function coordinatorTools(backend: CoordinatorBackend): ToolList {
  return [listSessions, readActivity, sendMessage, spawnSession, stopSession, findFolders, notifyPhone, ...manageTools].map((factory) => factory(backend));
}

export function createCoordinatorServer(backend: CoordinatorBackend): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({ name: COORDINATOR_SERVER_NAME, tools: coordinatorTools(backend) });
}
