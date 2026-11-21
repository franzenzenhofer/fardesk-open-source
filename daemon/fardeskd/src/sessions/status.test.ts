import { NO_LABEL } from "../service/labelStore.js";
import { describe, expect, it } from "vitest";
import { sessionSummarySchema } from "../contract/schema.js";
import type { SessionSummary } from "../contract/schema.js";
import type { TranscriptSummary } from "../transcript/index.js";
import type { LiveProcess } from "./claudeRegistry.js";
import { buildSessionSummary, resolveCwd, resolveTimes } from "./status.js";
import type { StatusInput } from "./status.js";

const T0 = "2026-11-15T10:00:00.000Z";
const T1 = "2026-11-15T10:05:00.000Z";
const T1_MS = Date.parse(T1);

const TRANSCRIPT: TranscriptSummary = {
  title: "Fix the build",
  summary: "Ran the tests",
  cwd: "/work/project",
  model: "claude-test",
  permissionMode: "default",
  startedAt: T0,
  updatedAt: T1,
  pendingToolUse: false,
  contextTokens: null,
  cacheExpiresAt: null,
};

function proc(overrides: Partial<LiveProcess> = {}): LiveProcess {
  return {
    pid: 4242,
    sessionId: "s1",
    cwd: "/live/cwd",
    status: "idle",
    name: "registry-name",
    kind: "interactive",
    entrypoint: "cli",
    tmux: null,
    messagingSocketPath: "/tmp/cc-socks/4242.sock",
    waitingFor: null,
    startedAt: Date.parse(T0),
    updatedAt: T1_MS,
    ...overrides,
  };
}

function input(overrides: Partial<StatusInput> = {}): StatusInput {
  return {
    id: "s1",
    process: proc(),
    summary: TRANSCRIPT,
    transcriptMtimeMs: T1_MS,
    owned: false,
    ownedBusy: false,
    pendingKind: null,
    muted: false,
    label: NO_LABEL,
    crossSessionAccepted: false,
    ...overrides,
  };
}

function build(overrides: Partial<StatusInput> = {}): SessionSummary {
  const source = input(overrides);
  const cwd = resolveCwd(source);
  const times = resolveTimes(source);
  if (cwd === null || times === null) throw new Error("test input has no cwd or times");
  const summary = buildSessionSummary(source, cwd, times);
  sessionSummarySchema.parse(summary);
  return summary;
}

type Row = {
  name: string;
  overrides: Partial<StatusInput>;
  expected: Partial<SessionSummary>;
};

const ROWS: Row[] = [
  {
    name: "no live process is ended and resumable",
    overrides: { process: null },
    expected: { status: "ended", replyMode: "resume", canStop: false, pid: null, waitingFor: null, summary: "Ran the tests" },
  },
  {
    name: "a pending request without any live process does not make an ended session wait",
    overrides: { process: null, pendingKind: "permission" },
    expected: { status: "ended", waitingFor: null },
  },
  { name: "registry busy is working", overrides: { process: proc({ status: "busy" }) }, expected: { status: "working", canStop: false } },
  {
    name: "registry busy with a tmux pane can be stopped",
    overrides: { process: proc({ status: "busy", tmux: "s:@0.%1" }) },
    expected: { status: "working", canStop: true },
  },
  { name: "registry idle is idle", overrides: { process: proc({ status: "idle", tmux: "s:@0.%1" }) }, expected: { status: "idle", canStop: false } },
  { name: "registry shell is idle", overrides: { process: proc({ status: "shell" }) }, expected: { status: "idle" } },
  { name: "an unknown registry status is idle", overrides: { process: proc({ status: "mystery" }) }, expected: { status: "idle" } },
  {
    name: "registry waiting without a pending request is a question at the computer, never an approval",
    overrides: { process: proc({ status: "waiting", waitingFor: "permission prompt" }) },
    expected: { status: "waiting", waitingFor: "terminal", summary: "Needs you at the computer: permission prompt", canStop: false },
  },
  {
    name: "registry waiting in a bypassPermissions session is also a terminal question",
    overrides: { process: proc({ status: "waiting" }), summary: { ...TRANSCRIPT, permissionMode: "bypassPermissions" } },
    expected: { status: "waiting", waitingFor: "terminal", summary: "Needs you at the computer" },
  },
  {
    name: "a bypass-mode session whose registry says waiting is a terminal wait and its replies take the takeover route",
    overrides: { process: proc({ status: "waiting", waitingFor: "permission prompt", messagingSocketPath: null }), summary: { ...TRANSCRIPT, permissionMode: "bypassPermissions" } },
    expected: { status: "waiting", waitingFor: "terminal", replyMode: "takeover" },
  },
  {
    name: "a dialog name of only spaces is no name",
    overrides: { process: proc({ status: "waiting", waitingFor: "  " }) },
    expected: { status: "waiting", waitingFor: "terminal", summary: "Needs you at the computer" },
  },
  {
    name: "a pending permission in a bypass-mode session is an approval",
    overrides: { process: proc({ status: "busy" }), pendingKind: "permission", summary: { ...TRANSCRIPT, permissionMode: "bypassPermissions" } },
    expected: { status: "waiting", waitingFor: "permission", summary: "Needs approval" },
  },
  {
    name: "a busy registry that names a dialog is not waiting",
    overrides: { process: proc({ status: "busy", waitingFor: "permission prompt" }) },
    expected: { status: "working", waitingFor: null, summary: "Ran the tests" },
  },
  {
    name: "an ended session has no terminal wait",
    overrides: { process: null },
    expected: { status: "ended", waitingFor: null },
  },
  {
    name: "a pending permission wins over registry waiting",
    overrides: { process: proc({ status: "waiting" }), pendingKind: "permission" },
    expected: { status: "waiting", waitingFor: "permission", summary: "Needs approval" },
  },
  {
    name: "registry back to idle clears the waiting state",
    overrides: { process: proc({ status: "idle" }) },
    expected: { status: "idle", waitingFor: null },
  },
  {
    name: "a pending permission wins over registry busy",
    overrides: { process: proc({ status: "busy" }), pendingKind: "permission" },
    expected: { status: "waiting", waitingFor: "permission", summary: "Needs approval" },
  },
  {
    name: "a pending question is a waiting question",
    overrides: { process: proc({ status: "waiting" }), pendingKind: "question" },
    expected: { status: "waiting", waitingFor: "question", summary: "Needs answer" },
  },
  {
    name: "owned and idle is a composer session",
    overrides: { owned: true, process: proc({ status: "idle", messagingSocketPath: null }) },
    expected: { status: "idle", owned: true, replyMode: "composer", canStop: false },
  },
  {
    name: "owned and busy can be stopped",
    overrides: { owned: true, process: proc({ status: "busy", messagingSocketPath: null }) },
    expected: { status: "working", owned: true, canStop: true, replyMode: "composer" },
  },
  {
    name: "owned runner busy beats a registry that still says idle",
    overrides: { owned: true, ownedBusy: true, process: proc({ status: "idle" }) },
    expected: { status: "working", canStop: true },
  },
  {
    name: "owned without a registry entry yet is idle",
    overrides: { owned: true, process: null },
    expected: { status: "idle", replyMode: "composer", pid: null },
  },
  {
    name: "owned without a registry entry yet and busy is working",
    overrides: { owned: true, ownedBusy: true, process: null },
    expected: { status: "working", canStop: true },
  },
  {
    name: "a busy flag of a session that is not owned is ignored",
    overrides: { ownedBusy: true, process: proc({ status: "idle" }) },
    expected: { status: "idle" },
  },
  {
    name: "a terminal session with an inbox in a prompting mode is a composer",
    overrides: { process: proc() },
    expected: { replyMode: "composer", owned: false },
  },
  {
    name: "a terminal session in bypass mode needs a takeover",
    overrides: { summary: { ...TRANSCRIPT, permissionMode: "bypassPermissions" } },
    expected: { replyMode: "takeover" },
  },
  {
    name: "a bypass-mode terminal session whose Claude home accepts cross-session messages is a composer",
    overrides: { summary: { ...TRANSCRIPT, permissionMode: "bypassPermissions" }, crossSessionAccepted: true },
    expected: { replyMode: "composer" },
  },
  {
    name: "accepting cross-session messages does not help a session without an inbox socket",
    overrides: { process: proc({ messagingSocketPath: null }), crossSessionAccepted: true },
    expected: { replyMode: "takeover" },
  },
  {
    name: "a terminal session without an inbox socket needs a takeover",
    overrides: { process: proc({ messagingSocketPath: null }) },
    expected: { replyMode: "takeover" },
  },
  { name: "the muted flag passes through", overrides: { muted: true }, expected: { muted: true, model: "claude-test", pid: 4242 } },
];

describe("buildSessionSummary status mapping", () => {
  it.each(ROWS)("$name", ({ overrides, expected }) => {
    expect(build(overrides)).toMatchObject(expected);
  });
});

describe("title", () => {
  it("prefers the transcript title, then the registry name, then the last path segment", () => {
    expect(build().title).toBe("Fix the build");
    expect(build({ summary: { ...TRANSCRIPT, title: null } }).title).toBe("registry-name");
    expect(build({ summary: { ...TRANSCRIPT, title: null }, process: proc({ name: null }) }).title).toBe("cwd");
    expect(build({ summary: { ...TRANSCRIPT, title: null }, process: proc({ name: null, cwd: "/work/project/" }) }).title).toBe("project");
  });

  it("falls back to the whole path when it has no segment", () => {
    expect(build({ summary: { ...TRANSCRIPT, title: null }, process: proc({ name: null, cwd: "/" }) }).title).toBe("/");
  });
});

describe("resolveCwd", () => {
  it("prefers the live process, then the transcript, else null", () => {
    expect(resolveCwd(input())).toBe("/live/cwd");
    expect(resolveCwd(input({ process: null }))).toBe("/work/project");
    expect(resolveCwd(input({ process: null, summary: { ...TRANSCRIPT, cwd: null } }))).toBeNull();
  });
});

describe("resolveTimes", () => {
  it("uses the transcript times and the newest of transcript, registry and file mtime for the update time", () => {
    const later = T1_MS + 60_000;
    expect(resolveTimes(input())).toEqual({ startedAt: T0, updatedAt: T1 });
    expect(resolveTimes(input({ process: proc({ updatedAt: later }) }))?.updatedAt).toBe(new Date(later).toISOString());
    expect(resolveTimes(input({ transcriptMtimeMs: later }))?.updatedAt).toBe(new Date(later).toISOString());
  });

  it("falls back to the registry, then to the file mtime, else null", () => {
    const empty = { ...TRANSCRIPT, startedAt: null, updatedAt: null };
    expect(resolveTimes(input({ summary: empty }))).toEqual({ startedAt: T0, updatedAt: T1 });
    expect(resolveTimes(input({ summary: empty, process: null }))).toEqual({ startedAt: T1, updatedAt: T1 });
    expect(resolveTimes(input({ summary: empty, process: null, transcriptMtimeMs: null }))).toBeNull();
    expect(resolveTimes(input({ summary: { ...empty, startedAt: T0 }, process: null, transcriptMtimeMs: null }))).toBeNull();
  });

  it("never reports a start after the last update", () => {
    const late = proc({ startedAt: T1_MS + 5_000, updatedAt: T1_MS });
    const empty = { ...TRANSCRIPT, startedAt: null, updatedAt: null };
    expect(resolveTimes(input({ summary: empty, process: late, transcriptMtimeMs: null }))).toEqual({ startedAt: T1, updatedAt: T1 });
  });
});
