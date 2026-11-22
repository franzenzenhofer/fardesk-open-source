import { basename } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROKEN_NAME,
  DOWN_NAME,
  LOCAL_NAME,
  PEER_NAME,
  UNLINKED_NAME,
  runTool,
  linkedPairSuite,
} from "../../test/support/coordinator.js";
import { FardeskError } from "../core/errors.js";
import { coordinatorTools } from "./tools.js";
import { createCoordinatorBackend } from "./backend.js";

const ALL = { machine: null, status: null, limit: 100 };
const suite = linkedPairSuite();

async function rejection(work: Promise<unknown>): Promise<FardeskError> {
  const error: unknown = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof FardeskError)) throw new Error("expected a FardeskError");
  return error;
}

describe("list_sessions", () => {
  it("lists compact rows of this machine and the linked peer, and reports the other machines", async () => {
    const listing = await suite.backend.listSessions(ALL);
    const ids = (machine: string): string[] => listing.sessions.filter((row) => row.machine === machine).map((row) => row.id);
    expect(ids(LOCAL_NAME)).toEqual([suite.pair.localSessionId]);
    expect(ids(PEER_NAME)).toEqual([suite.pair.peerSessionId]);
    expect(Object.keys(listing.sessions[0] ?? {}).toSorted()).toEqual(["id", "machine", "status", "summary", "title", "updatedAt", "waitingFor"]);
    const states = Object.fromEntries(listing.machines.map((report) => [report.machine, report.state]));
    expect(states).toEqual({
      [LOCAL_NAME]: "ok",
      [PEER_NAME]: "ok",
      [UNLINKED_NAME]: "not linked",
      [DOWN_NAME]: "unreachable",
      [BROKEN_NAME]: "unreachable",
    });
    const broken = listing.machines.find((report) => report.machine === BROKEN_NAME);
    expect(broken?.detail).toContain("unexpected body");
    expect(listing.machines.find((report) => report.machine === PEER_NAME)).toMatchObject({ count: 1 });
    expect(listing.matching).toBe(2);
  });

  it("filters by machine and status, and cuts the rows at the limit while still reporting how many matched", async () => {
    const onlyPeer = await suite.backend.listSessions({ ...ALL, machine: PEER_NAME });
    expect(onlyPeer.sessions.map((row) => row.id)).toEqual([suite.pair.peerSessionId]);
    expect(onlyPeer.machines.find((report) => report.machine === LOCAL_NAME)?.count).toBe(1);
    expect((await suite.backend.listSessions({ ...ALL, status: "working" })).sessions).toEqual([]);
    const cut = await suite.backend.listSessions({ ...ALL, limit: 1 });
    expect(cut).toMatchObject({ matching: 2 });
    expect(cut.sessions).toHaveLength(1);
  });
});

describe("read_activity", () => {
  it("returns the last rows of a local and of a peer session as short text lines", async () => {
    for (const [machine, sessionId] of [[LOCAL_NAME, suite.pair.localSessionId], [PEER_NAME, suite.pair.peerSessionId]] as const) {
      const lines = await suite.backend.readActivity(machine, sessionId, 3);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.length).toBeLessThanOrEqual(3);
      for (const line of lines) expect(line).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z (user|assistant|tool|files|system|question|permission): /);
    }
    const local = suite.pair.local.services.activity(suite.pair.localSessionId, { limit: 3 }).items.map((item) => item.id);
    expect(await suite.backend.readActivity(LOCAL_NAME, suite.pair.localSessionId, 3)).toHaveLength(local.length);
  });

  it("fails clearly for an unknown session on a peer, an unknown machine and an unlinked machine", async () => {
    expect((await rejection(suite.backend.readActivity(PEER_NAME, "no-such-session", 5))).code).toBe("not_found");
    const unknown = await rejection(suite.backend.readActivity("nowhere", "x", 5));
    expect(unknown.message).toContain(`known machines: ${LOCAL_NAME}, ${PEER_NAME}`);
    const unlinked = await rejection(suite.backend.readActivity(UNLINKED_NAME, "x", 5));
    expect(unlinked).toMatchObject({ code: "unsupported" });
    expect(unlinked.message).toContain("coordinator.peerTokens");
  });

  it("names the peer when it is down, answers with junk or fails without a JSON body", async () => {
    expect((await rejection(suite.backend.readActivity(DOWN_NAME, "x", 5))).message).toContain(`peer ${DOWN_NAME} is unreachable`);
    expect((await rejection(suite.backend.readActivity(BROKEN_NAME, "x", 5))).message).toContain(`peer ${BROKEN_NAME}: HTTP 500`);
  });
});

describe("send_message, spawn_session and stop_session", () => {
  it("reach the peer route and return its error for an ended session", async () => {
    const message = await rejection(suite.backend.sendMessage(PEER_NAME, suite.pair.peerSessionId, "hello"));
    expect(message).toMatchObject({ code: "conflict" });
    expect(message.message).toContain(`peer ${PEER_NAME}: session ${suite.pair.peerSessionId} cannot take messages`);
    const stop = await rejection(suite.backend.stopSession(PEER_NAME, suite.pair.peerSessionId));
    expect(stop.message).toContain(`peer ${PEER_NAME}: session ${suite.pair.peerSessionId} is not owned`);
  });

  it("reach this machine's own routes", async () => {
    expect((await rejection(suite.backend.sendMessage(LOCAL_NAME, suite.pair.localSessionId, "hello"))).code).toBe("conflict");
    expect((await rejection(suite.backend.stopSession(LOCAL_NAME, suite.pair.localSessionId))).code).toBe("unsupported");
  });

  it("spawn validates the folder on the target machine", async () => {
    const request = { cwd: "/no/such/folder", prompt: "x", model: null, worktree: false };
    expect((await rejection(suite.backend.spawnSession(PEER_NAME, request))).message).toContain(`peer ${PEER_NAME}: cwd is not an existing directory`);
    expect((await rejection(suite.backend.spawnSession(LOCAL_NAME, request))).code).toBe("invalid_request");
  });

  it("refuse an unlinked machine", async () => {
    expect((await rejection(suite.backend.sendMessage(UNLINKED_NAME, "x", "hi"))).code).toBe("unsupported");
    expect((await rejection(suite.backend.stopSession(UNLINKED_NAME, "x"))).code).toBe("unsupported");
    expect((await rejection(suite.backend.spawnSession(UNLINKED_NAME, { cwd: "/", prompt: "x", model: null, worktree: false }))).code).toBe("unsupported");
  });

  it("a wrong peer token is reported as the peer's 401", async () => {
    const wrong = createCoordinatorBackend({ ...suite.pair.local.config, coordinator: { ...suite.pair.local.config.coordinator, peerTokens: { [PEER_NAME]: "x".repeat(40) } } }, suite.pair.local.services, () => null);
    expect((await rejection(wrong.readActivity(PEER_NAME, suite.pair.peerSessionId, 1))).code).toBe("unauthorized");
  });
});

describe("find_folders", () => {
  it("asks a peer through its folder search route and fails clearly for unknown and unlinked machines", async () => {
    const peerFolder = suite.pair.peer.services.recentFolders().folders[0]?.path ?? "";
    const found = await suite.backend.findFolders(PEER_NAME, basename(peerFolder), 5);
    expect(found.folders[0]).toEqual({ path: peerFolder, recent: true });
    expect(await suite.backend.findFolders(LOCAL_NAME, basename(peerFolder), 5)).toEqual(suite.pair.local.services.searchFolders(basename(peerFolder), 5));
    expect((await rejection(suite.backend.findFolders(UNLINKED_NAME, "x", 5))).code).toBe("unsupported");
    expect((await rejection(suite.backend.findFolders("nowhere", "x", 5))).code).toBe("not_found");
  });
});

describe("the MCP tools", () => {
  const run = async (name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> => runTool(suite.backend, name, args);

  it("are exactly the fifteen named tools", () => {
    expect(coordinatorTools(suite.backend).map((candidate) => candidate.name)).toEqual([
      "list_sessions",
      "read_activity",
      "send_message",
      "spawn_session",
      "stop_session",
      "find_folders",
      "notify_phone",
      "search_sessions",
      "pending_requests",
      "answer_request",
      "resume_session",
      "clear_session",
      "compact_session",
      "end_session",
      "set_session_image",
      "clear_session_image",
      "update_machines",
    ]);
  });

  it("find_folders prints one path per line and says so when nothing matches", async () => {
    const peerFolder = suite.pair.peer.services.recentFolders().folders[0]?.path ?? "";
    const hit = await run("find_folders", { machine: PEER_NAME, query: basename(peerFolder).toUpperCase(), limit: 3 });
    expect(hit).toMatchObject({ isError: false });
    expect(hit.text.split("\n")[0]).toBe(`${peerFolder} (recent)`);
    expect((await run("find_folders", { machine: PEER_NAME, query: "zz-no-such-folder-zz", limit: 3 })).text).toContain("no folder on peer-mac matches");
    expect(await run("find_folders", { machine: UNLINKED_NAME, query: "x", limit: 3 })).toMatchObject({ isError: true });
  });

  it("list_sessions and read_activity return text the model can read", async () => {
    const listing = JSON.parse((await run("list_sessions", { limit: 30 })).text) as { sessions: { id: string }[] };
    expect(listing.sessions.map((row) => row.id).toSorted()).toEqual([suite.pair.localSessionId, suite.pair.peerSessionId].toSorted());
    const activity = await run("read_activity", { machine: PEER_NAME, sessionId: suite.pair.peerSessionId, limit: 2 });
    expect(activity).toMatchObject({ isError: false });
    expect(activity.text.split("\n").length).toBeLessThanOrEqual(2);
  });

  it("turn a failure into a tool error that names the cause", async () => {
    expect(await run("send_message", { machine: PEER_NAME, sessionId: suite.pair.peerSessionId, text: "hi" })).toMatchObject({ isError: true, text: expect.stringContaining("conflict:") as string });
    expect(await run("stop_session", { machine: UNLINKED_NAME, sessionId: "x" })).toMatchObject({ isError: true, text: expect.stringContaining("not linked") as string });
    expect(await run("spawn_session", { machine: LOCAL_NAME, cwd: "/no/such/folder", prompt: "x" })).toMatchObject({ isError: true });
  });
});
