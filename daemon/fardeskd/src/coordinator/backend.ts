// The coordinator's view of all machines: this daemon plus the linked peers.
import { FardeskError } from "../core/errors.js";
import type { Activity, PermissionDecision, SessionSummary } from "../contract/schema.js";
import { updateAll } from "../update/updateAll.js";
import { activityLine } from "./lines.js";
import { machinesOf, requireEndpoint } from "./local.js";
import type { BackendConfig, LocalServices, Machine } from "./local.js";
import type { CoordinatorBackend, ListQuery, MachineEndpoint, MachineReport, PendingRequest, SearchRow, SessionListing, SessionRow, SessionSearch } from "./types.js";

export { createLocalEndpoint } from "./local.js";
export type { LocalServices } from "./local.js";

/** How far back pending_requests looks in a session's feed for open requests. */
const PENDING_SCAN_ROWS = 100;

const toRow = (machine: string, { id, title, status, waitingFor, summary, updatedAt }: SessionSummary): SessionRow => ({
  machine,
  id,
  title,
  status,
  waitingFor,
  summary,
  updatedAt,
});

type Report<R> = { report: MachineReport; rows: R[] };
type Read = (machine: Machine) => Promise<SessionSummary[]>;

async function report<R>(machine: Machine, read: Read, pick: (session: SessionSummary) => R | null): Promise<Report<R>> {
  const base = { machine: machine.name, count: 0 };
  if (machine.endpoint === null) return { report: { ...base, state: "not linked", detail: null }, rows: [] };
  try {
    const sessions = await read(machine);
    const rows = sessions.map(pick).filter((row): row is R => row !== null);
    return { report: { ...base, state: "ok", count: sessions.length, detail: null }, rows };
  } catch (error) {
    return { report: { ...base, state: "unreachable", detail: error instanceof Error ? error.message : "request failed" }, rows: [] };
  }
}

async function across<R>(machines: Machine[], only: string | null, read: Read, pick: (machine: string, session: SessionSummary) => R | null): Promise<Report<R>[]> {
  // Every machine is reported (count, reachable); only the rows are limited to the chosen machine.
  return Promise.all(machines.map(async (machine) => report(machine, read, (session) => (only === null || machine.name === only ? pick(machine.name, session) : null))));
}

const visibleRead: Read = async (machine) => (machine.endpoint === null ? [] : machine.endpoint.sessions());
const fullRead: Read = async (machine) => (machine.endpoint === null ? [] : machine.endpoint.allSessions());

function openRequest(machine: string, session: { id: string; title: string }, activity: Activity): PendingRequest | null {
  const base = { machine, sessionId: session.id, title: session.title, requestId: "" };
  if (activity.kind === "permission" && activity.state === "pending" && activity.plan !== undefined) {
    return { ...base, requestId: activity.requestId, kind: "permission", what: `${activity.title}\n${activity.plan}`, options: [...(activity.planChoices ?? [])], plan: activity.plan };
  }
  if (activity.kind === "permission" && activity.state === "pending") {
    return { ...base, requestId: activity.requestId, kind: "permission", what: `${activity.title}: ${activity.summary}`, options: ["allow", "deny", "allow_always"] };
  }
  if (activity.kind === "question" && activity.state === "pending") {
    return { ...base, requestId: activity.requestId, kind: "question", what: activity.text, options: activity.options };
  }
  if (activity.kind === "dialog" && activity.state === "pending") {
    return { ...base, requestId: activity.requestId, kind: "dialog", what: `${activity.dialogKind}: ${JSON.stringify(activity.payload)}`, options: activity.choices };
  }
  return null;
}

async function requestsOf(machines: Machine[], machine: string, session: { id: string; title: string }): Promise<PendingRequest[]> {
  const page = await requireEndpoint(machines, machine).activity(session.id, PENDING_SCAN_ROWS);
  return page.items.map((activity) => openRequest(machine, session, activity)).filter((row): row is PendingRequest => row !== null);
}

type Reads = Pick<CoordinatorBackend, "listSessions" | "searchSessions" | "pendingRequests">;
type Actions = Omit<CoordinatorBackend, keyof Reads | "notifyPhone" | "updateMachines">;
type On = (machine: string) => MachineEndpoint;

const matchesText = (session: SessionSummary, needle: string): boolean =>
  [session.title, session.cwd, session.summary].some((field) => field.toLowerCase().includes(needle));

function listing<R extends SessionRow>(results: Report<R>[], limit: number, newestFirst: boolean): { machines: MachineReport[]; matching: number; sessions: R[] } {
  const rows = results.flatMap((entry) => entry.rows);
  const ordered = newestFirst ? rows.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : rows;
  return { machines: results.map((entry) => entry.report), matching: rows.length, sessions: ordered.slice(0, limit) };
}

function reads(machines: Machine[]): Reads {
  return {
    async listSessions(query: ListQuery): Promise<SessionListing> {
      const pick = (machine: string, session: SessionSummary): SessionRow | null =>
        query.status === null || session.status === query.status ? toRow(machine, session) : null;
      return listing(await across(machines, query.machine, visibleRead, pick), query.limit, false);
    },
    async searchSessions(query): Promise<SessionSearch> {
      const needle = query.text.toLowerCase();
      const pick = (machine: string, session: SessionSummary): SearchRow | null =>
        matchesText(session, needle) ? { ...toRow(machine, session), cwd: session.cwd } : null;
      return listing(await across(machines, query.machine, fullRead, pick), query.limit, true);
    },
    async pendingRequests(query): Promise<PendingRequest[]> {
      if (query.sessionId !== null) {
        if (query.machine === null) throw new FardeskError("invalid_request", "pending_requests needs the machine together with sessionId");
        return requestsOf(machines, query.machine, { id: query.sessionId, title: query.sessionId });
      }
      const waiting = await across(machines, query.machine, visibleRead, (machine, session) => (session.status === "waiting" ? toRow(machine, session) : null));
      const found = await Promise.all(waiting.flatMap((entry) => entry.rows).map(async (row) => requestsOf(machines, row.machine, row)));
      return found.flat();
    },
  };
}

/** Without `coordinator.mayApprove` the coordinator may deny a request but never allow one: that stays with the human. */
function guardApproval(mayApprove: boolean, decision: PermissionDecision): void {
  if (!mayApprove && decision !== "deny" && decision !== "revise") {
    throw new FardeskError("unsupported", "the Coordinator may not approve permission requests: set coordinator.mayApprove to true in config.json to allow it");
  }
}

function actions(on: On, mayApprove: boolean): Actions {
  return {
    readActivity: async (machine, sessionId, limit) => (await on(machine).activity(sessionId, limit)).items.map(activityLine),
    sendMessage: async (machine, sessionId, text) => on(machine).message(sessionId, text),
    spawnSession: async (machine, request) => on(machine).spawn(request),
    stopSession: async (machine, sessionId) => on(machine).stop(sessionId),
    findFolders: async (machine, query, limit) => on(machine).folders(query, limit),
    decidePermission: async (machine, sessionId, requestId, { decision, message }): Promise<void> => {
      guardApproval(mayApprove, decision);
      await on(machine).decide(sessionId, requestId, decision, message);
    },
    answerQuestion: async (machine, sessionId, requestId, option) => on(machine).answer(sessionId, requestId, option),
    answerDialog: async (machine, sessionId, requestId, answer) => on(machine).answerDialog(sessionId, requestId, answer),
    resumeSession: async (machine, sessionId) => on(machine).resume(sessionId),
    clearSession: async (machine, sessionId) => on(machine).clear(sessionId),
    compactSession: async (machine, sessionId) => on(machine).compact(sessionId),
    setSessionImage: async (machine, sessionId, image) => on(machine).setImage(sessionId, image),
    clearSessionImage: async (machine, sessionId) => on(machine).clearImage(sessionId),
    async endSession(machine, sessionId): Promise<string> {
      await on(machine).kill(sessionId);
      return sessionId;
    },
  };
}

/** currentSession = the coordinator's own session id: the one a tapped notification opens. */
export function createCoordinatorBackend(config: BackendConfig, services: LocalServices, currentSession: () => string | null): CoordinatorBackend {
  const machines = machinesOf(config, services);
  return {
    ...reads(machines),
    ...actions((machine) => requireEndpoint(machines, machine), config.coordinator.mayApprove),
    updateMachines: async () => updateAll(machines, config.name),
    async notifyPhone(title, body): Promise<number> {
      const sessionId = currentSession();
      if (sessionId === null) throw new FardeskError("conflict", "the coordinator session has no id yet");
      return services.notifyPhone(sessionId, title, body);
    },
  };
}
