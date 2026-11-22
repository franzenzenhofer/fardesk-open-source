// What the coordinator can do on one machine, and the rows it reports.
import type { RequestAnswers } from "../service/types.js";
import type { ActivityPage, ClosedTarget, FolderSearch, Machine, NewSessionRequest, PermissionDecision, SessionStatus, SessionSummary, UpdateAllResult } from "../contract/schema.js";

/** One machine as the coordinator sees it: this daemon (Services) or a peer daemon over HTTP. */
/** The calls that update a machine; the rest of the endpoint is about its sessions. */
export type UpdateKeys = "machine" | "updatePackage" | "startUpdate";

export type MachineEndpoint = RequestAnswers & {
  sessions(): Promise<SessionSummary[]>;
  /** Every session the machine knows, also old ended ones. */
  allSessions(): Promise<SessionSummary[]>;
  activity(sessionId: string, limit: number): Promise<ActivityPage>;
  message(sessionId: string, text: string): Promise<void>;
  spawn(request: NewSessionRequest): Promise<string>;
  stop(sessionId: string): Promise<void>;
  folders(query: string, limit: number): Promise<FolderSearch>;
  resume(sessionId: string): Promise<string>;
  clear(sessionId: string): Promise<string>;
  compact(sessionId: string): Promise<string>;
  kill(sessionId: string): Promise<ClosedTarget>;
  /** Sets the chat image of a session (JPEG or PNG, checked by the machine); resolves with its hash. */
  setImage(sessionId: string, image: ChatImage): Promise<string>;
  clearImage(sessionId: string): Promise<void>;
  /** This machine's facts, for its version. */
  machine(): Promise<Machine>;
  /** The machine's own release package (the tarball it was installed from). */
  updatePackage(): Promise<Uint8Array>;
  /** Hands the machine a release package to install in the background; resolves once it accepted it. */
  startUpdate(bytes: Uint8Array, sha256: string): Promise<void>;
};

/** A checked chat image: the type that its magic bytes prove, and the bytes. */
export type ChatImage = { mediaType: "image/jpeg" | "image/png"; bytes: Uint8Array };

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
  kind: "permission" | "question" | "dialog";
  what: string;
  options: string[];
  /** Only a plan request ("Ready to code?"): the whole plan; `options` then are the plan decisions, `revise` needs a message. */
  plan?: string;
};
/** A permission answer: for a plan request `revise` carries the message telling Claude what to change. */
export type PermissionAnswer = { decision: PermissionDecision; message?: string };
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
  decidePermission(machine: string, sessionId: string, requestId: string, answer: PermissionAnswer): Promise<void>;
  answerQuestion(machine: string, sessionId: string, requestId: string, option: string): Promise<void>;
  answerDialog(machine: string, sessionId: string, requestId: string, answer: string): Promise<void>;
  /** Each of these resolves with the id of the session that continues (resume, clear: may be new; compact, end: the same). */
  resumeSession(machine: string, sessionId: string): Promise<string>;
  clearSession(machine: string, sessionId: string): Promise<string>;
  compactSession(machine: string, sessionId: string): Promise<string>;
  endSession(machine: string, sessionId: string): Promise<string>;
  /** Sets the chat image shown in the phone list for a session of any machine; resolves with the image hash. */
  setSessionImage(machine: string, sessionId: string, image: ChatImage): Promise<string>;
  clearSessionImage(machine: string, sessionId: string): Promise<void>;
  /** Pushes to every device registered on this daemon; resolves to how many accepted it. */
  notifyPhone(title: string, body: string): Promise<number>;
  /** Brings every machine of the fleet to the newest version in it (the hub's update-all). */
  updateMachines(): Promise<UpdateAllResult>;
};
