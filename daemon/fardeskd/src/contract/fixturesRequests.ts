import type { FixtureCases } from "./fixtureTypes.js";

const FAKE_TOKEN_64 = "a1b2c3d4".repeat(8);
const FAKE_CODE = "Zk3vQ9mT2xLp7WcR5nYb8HdJ4sGfA1uEoIq6VtXzNaM";
const FAKE_TOKEN_128 = "0f1e2d3c4b5a6978".repeat(8);

export const recentFoldersFixtures: FixtureCases<"RecentFolders"> = {
  two: {
    folders: [
      { path: "/Users/dev/smear-studio", lastUsedAt: "2026-11-14T09:12:03.000Z" },
      { path: "/Users/dev/crawler", lastUsedAt: "2026-11-13T17:02:10.000Z" },
    ],
  },
  none: { folders: [] },
};

export const folderSearchFixtures: FixtureCases<"FolderSearch"> = {
  recentAndRepo: {
    folders: [
      { path: "/Users/dev/smear-studio", recent: true },
      { path: "/Users/dev/games/smear-lab", recent: false },
    ],
  },
  none: { folders: [] },
};

export const coordinatorStateFixtures: FixtureCases<"CoordinatorState"> = {
  notStarted: { sessionId: null },
  running: { sessionId: "6f1c2b7e-3d4a-4c1e-9b0a-2f8e5d7c1a90" },
};

export const messageRequestFixtures: FixtureCases<"MessageRequest"> = {
  text: { text: "Please also add a test for the falloff." },
  withAttachments: { text: "What is wrong in this screenshot?", attachments: ["1f6e0b7a-2c3d-4e5f-8a9b-0c1d2e3f4a5b"] },
};

export const permissionRequestFixtures: FixtureCases<"PermissionRequest"> = {
  allow: { decision: "allow" },
  deny: { decision: "deny" },
  allowAlways: { decision: "allow_always" },
};

export const answerRequestFixtures: FixtureCases<"AnswerRequest"> = { option: { option: "PNG" } };

export const muteRequestFixtures: FixtureCases<"MuteRequest"> = {
  muted: { muted: true },
  unmuted: { muted: false },
};

export const labelRequestFixtures: FixtureCases<"LabelRequest"> = {
  rename: { name: "Release work" },
  recolour: { color: "teal" },
  blue: { color: "blue" },
  purple: { color: "purple" },
  pink: { color: "pink" },
  pin: { pinned: true },
  clear: { name: null, color: null, pinned: false },
};

export const newSessionRequestFixtures: FixtureCases<"NewSessionRequest"> = {
  withWorktreeAndModel: {
    cwd: "/Users/dev/smear-studio",
    prompt: "Fix the flicker in the canvas view.",
    worktree: true,
    model: "claude-opus-5-5",
  },
  plainDefaultModel: { cwd: "/Users/dev/crawler", prompt: "Summarise open TODOs.", worktree: false, model: null },
  modeDefault: { cwd: "/Users/dev/crawler", prompt: "Ask before each tool.", worktree: false, model: null, permissionMode: "default" },
  modeAcceptEdits: { cwd: "/Users/dev/crawler", prompt: "Edit freely.", worktree: false, model: null, permissionMode: "acceptEdits" },
  modeBypass: { cwd: "/Users/dev/crawler", prompt: "Run everything.", worktree: false, model: null, permissionMode: "bypassPermissions" },
  modeDontAsk: { cwd: "/Users/dev/crawler", prompt: "Never ask.", worktree: false, model: null, permissionMode: "dontAsk" },
  modeAuto: { cwd: "/Users/dev/crawler", prompt: "Let the classifier decide.", worktree: false, model: null, permissionMode: "auto" },
  withPermissionMode: { cwd: "/Users/dev/crawler", prompt: "Plan the retry rewrite.", worktree: false, model: null, permissionMode: "plan" },
};

export const coordinatorRequestFixtures: FixtureCases<"CoordinatorRequest"> = {
  prompt: { prompt: "Which sessions are waiting for me on any machine?" },
};

export const deviceRequestFixtures: FixtureCases<"DeviceRequest"> = {
  sandboxAllTypes: {
    apnsToken: FAKE_TOKEN_64,
    environment: "sandbox",
    name: "Test iPhone",
    notifications: ["done", "permission", "question", "ended"],
  },
  productionNoNotifications: {
    apnsToken: FAKE_TOKEN_128,
    environment: "production",
    name: "Test iPad",
    notifications: [],
  },
};

export const actionResultFixtures: FixtureCases<"ActionResult"> = { session: { sessionId: "sess_7f3a91" } };
export const okResultFixtures: FixtureCases<"OkResult"> = { ok: { ok: true } };
export const messageResultFixtures: FixtureCases<"MessageResult"> = {
  delivered: { ok: true },
  queued: { ok: true, queued: true },
  notQueued: { ok: true, queued: false },
};

export const errorResponseFixtures: FixtureCases<"ErrorResponse"> = {
  unauthorized: { error: { code: "unauthorized", message: "Missing or invalid token" } },
  tokenRevoked: { error: { code: "token_revoked", message: "This device was revoked" } },
  rateLimited: { error: { code: "rate_limited", message: "Too many attempts, try again later" } },
  notFound: { error: { code: "not_found", message: "No such session" } },
  invalidRequest: { error: { code: "invalid_request", message: "Field text must not be empty" } },
  conflict: { error: { code: "conflict", message: "Permission already decided" } },
  unsupported: { error: { code: "unsupported", message: "Session cannot be stopped" } },
  internal: { error: { code: "internal", message: "Unexpected failure" } },
  machineOffline: { error: { code: "machine_offline", message: "Studio is offline: no answer within 5 s; last seen 2026-11-16T07:18:00.000Z" } },
};

export const pairingPayloadFixtures: FixtureCases<"PairingPayload"> = {
  lan: { v: 1, name: "Studio Mac", url: "http://192.0.2.10:7878", code: FAKE_CODE, hub: false },
  tls: { v: 1, name: "Build Box", url: "https://desk.example.com:7443/", code: FAKE_CODE, hub: true },
};
