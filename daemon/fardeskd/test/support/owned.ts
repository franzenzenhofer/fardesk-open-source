// Helpers for the owned-runner tests: real claude, real SDK, the real Claude home, unique temp project dirs.
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect } from "vitest";
import { mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Activity } from "../../src/contract/schema.js";
import { createBus, type Bus } from "../../src/core/bus.js";
import { FardeskError } from "../../src/core/errors.js";
import { createLogger } from "../../src/core/log.js";
import { CLAUDE_CONFIG_ENV } from "../../src/owned/claudeEnv.js";
import { createOwnedRunner, type OwnedRunnerDeps } from "../../src/owned/runner.js";
import type { OwnedRunner } from "../../src/owned/types.js";
import { createBroker, type Broker } from "../../src/permissions/broker.js";
import { readClaudeRegistry } from "../../src/sessions/claudeRegistry.js";
import { findTranscripts } from "../../src/sessions/transcriptFiles.js";
import { makeTempDir, sleep, waitUntil } from "./env.js";

/** The home whose login the person running the tests uses: the one Claude Code itself picks (CLAUDE_CONFIG_DIR, else ~/.claude). */
export const CLAUDE_HOME = process.env[CLAUDE_CONFIG_ENV] ?? join(homedir(), ".claude");
export const TEST_MODEL = "haiku";
export const TURN_TIMEOUT_MS = 90_000;
const TRASH_DIR = fileURLToPath(new URL("../../../../trash/", import.meta.url));
const BROKER_TIMEOUT_MS = 120_000;
const KILL = { timeoutMs: 15_000, pollMs: 50 };

export type PendingRequest = { sessionId: string; requestId: string; activity: Activity };

export type OwnedEnv = {
  cwd: string;
  statePath: string;
  broker: Broker;
  logs: string[];
  pending: PendingRequest[];
  runner: OwnedRunner;
  makeRunner(overrides?: Partial<OwnedRunnerDeps>): OwnedRunner;
};

export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

function collectPending(bus: Bus): PendingRequest[] {
  const pending: PendingRequest[] = [];
  bus.subscribe((event) => {
    if (event.type !== "activity") return;
    const { activity } = event;
    if ((activity.kind === "permission" || activity.kind === "question") && activity.state === "pending") {
      pending.push({ sessionId: event.sessionId, requestId: activity.requestId, activity });
    }
  });
  return pending;
}

export function makeOwnedEnv(): OwnedEnv {
  const cwd = makeTempDir("fd-owned-");
  const bus = createBus();
  const logs: string[] = [];
  const pending = collectPending(bus);
  const broker = createBroker({ timeoutMs: BROKER_TIMEOUT_MS, bus, now: () => new Date(), newId: randomUUID });
  const base: OwnedRunnerDeps = {
    claudeBinary: installedClaude(),
    claudeHome: CLAUDE_HOME,
    statePath: join(makeTempDir("fd-state-"), "owned.json"),
    permissionMode: "default",
    allowBypass: true,
    findMode: (): null => null,
    interruptTimeoutMs: 20_000,
    clearTimeoutMs: 30_000,
    compactTimeoutMs: 120_000,
    kill: KILL,
    broker,
    log: createLogger((line) => logs.push(line), () => new Date()),
    findCwd: (sessionId): string => {
      if (!findTranscripts(CLAUDE_HOME).some((ref) => ref.sessionId === sessionId)) {
        throw new FardeskError("not_found", `no transcript for ${sessionId}`);
      }
      return cwd;
    },
  };
  const makeRunner = (overrides: Partial<OwnedRunnerDeps> = {}): OwnedRunner => createOwnedRunner({ ...base, ...overrides });
  return { cwd, statePath: base.statePath, broker, logs, pending, runner: makeRunner(), makeRunner };
}

function installedClaude(): string {
  return join(homedir(), ".local", "bin", "claude");
}

/** Registers beforeEach/afterEach: a fresh env per test, then close, no leftover child, project folder to trash. */
export function useOwnedEnv(): () => OwnedEnv {
  let env: OwnedEnv | undefined;
  beforeEach(() => {
    env = makeOwnedEnv();
  });
  afterEach(async () => {
    const current = requireEnv(env);
    await current.runner.close();
    expect(registryEntriesIn(current.cwd)).toBe(0);
    moveProjectFoldersToTrash(current.cwd);
  });
  return () => requireEnv(env);
}

function requireEnv(env: OwnedEnv | undefined): OwnedEnv {
  if (env === undefined) throw new Error("env not initialised");
  return env;
}

export function transcriptPath(sessionId: string): string {
  const ref = findTranscripts(CLAUDE_HOME).find((candidate) => candidate.sessionId === sessionId);
  if (ref === undefined) throw new Error(`no transcript for ${sessionId}`);
  return ref.path;
}

export function transcriptText(sessionId: string): string {
  return readFileSync(transcriptPath(sessionId), "utf8");
}

export function transcriptLineCount(sessionId: string): number {
  return transcriptText(sessionId).split("\n").filter((line) => line.length > 0).length;
}

export async function waitForTranscript(sessionId: string, needle: string): Promise<void> {
  await waitUntil(() => {
    try {
      return transcriptText(sessionId).includes(needle);
    } catch {
      return false;
    }
  }, TURN_TIMEOUT_MS);
}

export async function waitForPending(env: OwnedEnv, kind: "permission" | "question"): Promise<PendingRequest> {
  await waitUntil(() => env.pending.some((request) => request.activity.kind === kind), TURN_TIMEOUT_MS);
  const found = env.pending.find((request) => request.activity.kind === kind);
  if (found === undefined) throw new Error("unreachable");
  return found;
}

export async function waitForIdle(env: OwnedEnv, sessionId: string): Promise<void> {
  await sleep(200);
  await waitUntil(() => !env.runner.isBusy(sessionId), TURN_TIMEOUT_MS);
}

/** Starts a real owned haiku session and waits until its first turn is answered and finished. */
export async function startIdleSession(env: OwnedEnv): Promise<string> {
  const id = await env.runner.start({ cwd: env.cwd, prompt: "Reply with the single word OK.", worktree: false, model: TEST_MODEL });
  await waitForTranscript(id, '"type":"assistant"');
  await waitForIdle(env, id);
  return id;
}

export function registryEntriesIn(cwd: string): number {
  return readClaudeRegistry(CLAUDE_HOME).processes.filter((process) => process.cwd.startsWith(cwd)).length;
}

export function moveProjectFoldersToTrash(cwd: string): void {
  const prefix = encodeCwd(cwd);
  const projects = join(CLAUDE_HOME, "projects");
  mkdirSync(TRASH_DIR, { recursive: true });
  for (const name of readdirSync(projects).filter((entry) => entry.startsWith(prefix))) {
    renameSync(join(projects, name), join(TRASH_DIR, `owned-test-${Date.now()}-${name}`));
  }
}
