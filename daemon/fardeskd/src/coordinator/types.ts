// What the coordinator can do on one machine, and the rows it reports.
import type { ActivityPage, ClosedTarget, FolderSearch, NewSessionRequest, PermissionDecision, SessionStatus, SessionSummary } from "../contract/schema.js";

/** One machine as the coordinator sees it: this daemon (Services) or a peer daemon over HTTP. */
export type MachineEndpoint = {
  sessions(): Promise<SessionSummary[]>;
  /** Every session the machine knows, also old ended ones. */
  allSessions(): Promise<SessionSummary[]>;
  activity(sessionId: string, limit: number): Promise<ActivityPage>;
  message(sessionId: string, text: string): Promise<void>;
  spawn(request: NewSessionRequest): Promise<string>;
  stop(sessionId: string): Promise<void>;
  folders(query: string, limit: number): Promise<FolderSearch>;
  decide(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  answer(sessionId: string, requestId: string, option: string): Promise<void>;
  resume(sessionId: string): Promise<string>;
  clear(sessionId: string): Promise<string>;
  compact(sessionId: string): Promise<string>;
  kill(sessionId: string): Promise<ClosedTarget>;
};

export type SessionRow = Pick<SessionSummary, "id" | "title" | "status" | "waitingFor" | "summary" | "updatedAt"> & { machine: string };

/** count = all sessions the machine reported, before any filter. */
export type MachineReport = { machine: string; state: "ok" | "not linked" | "unreachable"; count: number; detail: string | null };

export type ListQuery = { machine: string | null; status: SessionStatus | null; limit: number };

/** sessions = the rows that match the query, at most query.limit of them; matching = how many matched in total. */
export type SessionListing = { machines: MachineReport[]; matching: number; sessions: SessionRow[] };

/** One session found by search_sessions: the row plus where it ran. */
export type SearchRow = SessionRow & { cwd: string };
export type SessionSearch = { machines: MachineReport[]; matching: number; sessions: SearchRow[] };
export type SearchQuery = { text: string; machine: string | null; limit: number };

/** One open permission request or question of a session. what = the command or question text. */
export type PendingRequest = {
  machine: string;
  sessionId: string;
  title: string;
  requestId: string;
  kind: "permission" | "question";
  what: string;
  options: string[];
};
export type PendingQuery = { machine: string | null; sessionId: string | null };

export type SpawnRequest = { cwd: string; prompt: string; model: string | null; worktree: boolean };

export type CoordinatorBackend = {
  listSessions(query: ListQuery): Promise<SessionListing>;
  readActivity(machine: string, sessionId: string, limit: number): Promise<string[]>;
  sendMessage(machine: string, sessionId: string, text: string): Promise<void>;
  spawnSession(machine: string, request: SpawnRequest): Promise<string>;
  stopSession(machine: string, sessionId: string): Promise<void>;
  findFolders(machine: string, query: string, limit: number): Promise<FolderSearch>;
  searchSessions(query: SearchQuery): Promise<SessionSearch>;
  /** Open requests of one session (machine + sessionId), or of every waiting session (of one machine or all). */
  pendingRequests(query: PendingQuery): Promise<PendingRequest[]>;
  decidePermission(machine: string, sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  answerQuestion(machine: string, sessionId: string, requestId: string, option: string): Promise<void>;
  /** Each of these resolves with the id of the session that continues (resume, clear: may be new; compact, end: the same). */
  resumeSession(machine: string, sessionId: string): Promise<string>;
  clearSession(machine: string, sessionId: string): Promise<string>;
  compactSession(machine: string, sessionId: string): Promise<string>;
  endSession(machine: string, sessionId: string): Promise<string>;
  /** Pushes to every device registered on this daemon; resolves to how many accepted it. */
  notifyPhone(title: string, body: string): Promise<number>;
};
