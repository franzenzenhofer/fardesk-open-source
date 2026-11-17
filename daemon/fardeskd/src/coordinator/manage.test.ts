import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_NAME, PEER_NAME, UNLINKED_NAME, runTool, linkedPairSuite } from "../../test/support/coordinator.js";
import { HOOK_SESSION_ID, fireHook, pendingRequestId, seedHookSession } from "../../test/support/hookSession.js";
import { COORDINATOR_DIR, coordinatorSessions } from "./session.js";
import type { PendingRequest } from "./types.js";

const suite = linkedPairSuite();

describe("search_sessions", () => {
  it("finds sessions of every machine by title or folder text, case-insensitive, from the full list", async () => {
    const peerSession = suite.pair.peer.services.allSessions().find((session) => session.id === suite.pair.peerSessionId);
    const word = (peerSession?.title ?? "").split(" ")[0] ?? "";
    const found = await suite.backend.searchSessions({ text: word.toUpperCase(), machine: null, limit: 20 });
    expect(found.sessions.map((row) => row.id)).toContain(suite.pair.peerSessionId);
    expect(found.sessions.every((row) => typeof row.cwd === "string")).toBe(true);
    const onlyLocal = await suite.backend.searchSessions({ text: word, machine: LOCAL_NAME, limit: 20 });
    expect(onlyLocal.sessions.every((row) => row.machine === LOCAL_NAME)).toBe(true);
    expect((await runTool(suite.backend, "search_sessions", { text: "zz-nothing-zz" })).text).toContain('"matching":0');
  });
});

describe("pending_requests and answer_request", () => {
  it("show what a waiting peer session asks and allow it, which releases the waiting hook", async () => {
    await seedHookSession(suite.pair.peer);
    const hook = fireHook(suite.pair.peer, "PermissionRequest-bash.json");
    const requestId = await pendingRequestId(suite.pair.peer, "permission");
    const listed = JSON.parse((await runTool(suite.backend, "pending_requests", { machine: PEER_NAME, sessionId: HOOK_SESSION_ID })).text) as PendingRequest[];
    expect(listed).toEqual([expect.objectContaining({ machine: PEER_NAME, sessionId: HOOK_SESSION_ID, requestId, kind: "permission" }) as PendingRequest]);
    const everywhere = await suite.backend.pendingRequests({ machine: null, sessionId: null });
    expect(everywhere.map((request) => request.requestId)).toContain(requestId);
    const answered = await runTool(suite.backend, "answer_request", { machine: PEER_NAME, sessionId: HOOK_SESSION_ID, requestId, decision: "allow" });
    expect(answered).toEqual({ text: "permission allow", isError: false });
    expect((await hook).stdout).toContain("allow");
    expect((await runTool(suite.backend, "pending_requests", { machine: PEER_NAME, sessionId: HOOK_SESSION_ID })).text).toBe("no open requests");
  });

  it("refuse an answer without decision or option, and a sessionId without machine", async () => {
    expect(await runTool(suite.backend, "answer_request", { machine: PEER_NAME, sessionId: "x", requestId: "y" })).toMatchObject({ isError: true });
    expect(await runTool(suite.backend, "pending_requests", { sessionId: "x" })).toMatchObject({ isError: true, text: expect.stringContaining("needs the machine") as string });
  });
});

describe("resume, clear, compact and end", () => {
  it("name the cause when the machine is not linked or the session is unknown", async () => {
    for (const name of ["resume_session", "clear_session", "compact_session", "end_session"]) {
      expect(await runTool(suite.backend, name, { machine: UNLINKED_NAME, sessionId: "x" })).toMatchObject({ isError: true, text: expect.stringContaining("not linked") as string });
      expect(await runTool(suite.backend, name, { machine: PEER_NAME, sessionId: "no-such-session" })).toMatchObject({ isError: true });
    }
  });
});

describe("GET /v1/sessions?scope=all", () => {
  it("returns the full store for scope=all, the client list by default, and rejects other scopes", async () => {
    const all = await suite.pair.peer.call("GET", "/v1/sessions?scope=all");
    expect(all.status).toBe(200);
    expect((all.json as { id: string }[]).length).toBe(suite.pair.peer.services.allSessions().length);
    expect((await suite.pair.peer.call("GET", "/v1/sessions")).status).toBe(200);
    expect((await suite.pair.peer.call("GET", "/v1/sessions?scope=everything")).status).toBe(400);
  });
});

describe("coordinatorSessions", () => {
  it("keeps only sessions in the coordinator folder, newest first", () => {
    const folder = join("/state", COORDINATOR_DIR);
    const session = suite.pair.local.services.allSessions()[0];
    if (session === undefined) throw new Error("the pair has a local session");
    const sessions = [
      { ...session, id: "old", cwd: folder, updatedAt: "2026-11-16T10:00:00.000Z" },
      { ...session, id: "project", cwd: "/state/coordinator-app", updatedAt: "2026-11-16T12:00:00.000Z" },
      { ...session, id: "new", cwd: folder, updatedAt: "2026-11-16T11:00:00.000Z" },
    ];
    expect(coordinatorSessions(sessions, folder).map((entry) => entry.id)).toEqual(["new", "old"]);
  });
});
