import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expectApiKilled, expectApiOk } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir, sleep, waitUntil } from "../../test/support/env.js";
import { CLAUDE_HOME, TEST_MODEL, TURN_TIMEOUT_MS, moveProjectFoldersToTrash, transcriptText } from "../../test/support/owned.js";
import { runHook } from "../../test/support/hookRun.js";
import { buildHookCommand } from "../hooks/command.js";
import { actionResultSchema } from "../contract/schema.js";
import { readClaudeRegistry } from "../sessions/claudeRegistry.js";
import { hookSocket } from "../../test/support/daemon.js";

const TEST_TIMEOUT_MS = 240_000;
// /v1/sessions/new answers on the first system/init, not at the end of the turn: seconds, never minutes.
const START_RESPONSE_BUDGET_MS = 30_000;
let daemon: TestDaemon | null = null;
let cwd = "";

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  moveProjectFoldersToTrash(cwd);
});

async function post(path: string, body?: unknown): Promise<string> {
  const response = await daemon?.call("POST", path, body);
  expect(response?.status).toBe(200);
  return actionResultSchema.parse(response?.json).sessionId;
}

const sessionOf = (id: string): { owned: boolean; status: string; contextTokens: number | null } | undefined =>
  daemon?.services.sessions().find((session) => session.id === id);

const compactBoundaries = (id: string): number => transcriptText(id).split(`"subtype":"compact_boundary"`).length - 1;

const assistantTexts = (id: string): string =>
  (daemon?.services.activity(id, { limit: 200 }).items ?? []).flatMap((item) => (item.kind === "assistant" ? [item.text] : [])).join("\n");

describe("owned sessions through the HTTP API (real claude, haiku)", () => {
  it("starts, messages, interrupts, kills, resumes, takes over and forks a session", async () => {
    cwd = makeTempDir("fd-owned-");
    daemon = await startTestDaemon({ claudeHomes: [CLAUDE_HOME], intervals: { registryPollMs: 200, transcriptPollMs: 100, pingMs: 60_000 } });
    const id = await post("/v1/sessions/new", { cwd, prompt: "Reply with the single word OK.", worktree: false, model: TEST_MODEL });
    await waitUntil(() => sessionOf(id)?.owned === true, TURN_TIMEOUT_MS);
    await waitUntil(() => assistantTexts(id).includes("OK"), TURN_TIMEOUT_MS);

    await expectApiOk(daemon, `/v1/sessions/${id}/message`, { text: "Reply with the single word PINEAPPLE." });
    await waitUntil(() => assistantTexts(id).includes("PINEAPPLE"), TURN_TIMEOUT_MS);

    const hook = JSON.stringify({ session_id: id, hook_event_name: "PermissionRequest", tool_name: "Bash", tool_input: { command: "ls" }, cwd });
    const run = await runHook(buildHookCommand(hookSocket(daemon), 5), hook);
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(daemon.services.activity(id, {}).items.some((item) => item.kind === "permission")).toBe(false);

    await expectApiOk(daemon, `/v1/sessions/${id}/stop`);
    expect(await expectApiKilled(daemon, `/v1/sessions/${id}/kill`)).toBe("none");
    await waitUntil(() => sessionOf(id)?.status === "ended", TURN_TIMEOUT_MS);
    expect(sessionOf(id)?.owned).toBe(false);

    expect(await post(`/v1/sessions/${id}/resume`)).toBe(id);
    expect(await post(`/v1/sessions/${id}/takeover`)).toBe(id);
    await waitUntil(() => sessionOf(id)?.owned === true, TURN_TIMEOUT_MS);
    const forked = await post(`/v1/sessions/${id}/fork`);
    expect(forked).not.toBe(id);
    await waitUntil(() => sessionOf(forked)?.owned === true, TURN_TIMEOUT_MS);
  }, TEST_TIMEOUT_MS);

  it("compacts an owned session, then resumes an ended one as owned and compacts it, under the same id", async () => {
    cwd = makeTempDir("fd-owned-");
    daemon = await startTestDaemon({ claudeHomes: [CLAUDE_HOME], intervals: { registryPollMs: 200, transcriptPollMs: 100, pingMs: 60_000 } });
    const id = await post("/v1/sessions/new", { cwd, prompt: "Reply with the single word OK.", worktree: false, model: TEST_MODEL });
    await waitUntil(() => (sessionOf(id)?.contextTokens ?? 0) > 0, TURN_TIMEOUT_MS);
    await expectApiOk(daemon, `/v1/sessions/${id}/message`, { text: "Name three fruits in one short sentence." });
    await waitUntil(() => assistantTexts(id).split("\n").length >= 2, TURN_TIMEOUT_MS);
    await waitUntil(() => sessionOf(id)?.status === "idle", TURN_TIMEOUT_MS);

    expect(await post(`/v1/sessions/${id}/compact`)).toBe(id);
    expect(compactBoundaries(id)).toBe(1);

    expect(await expectApiKilled(daemon, `/v1/sessions/${id}/kill`)).toBe("none");
    await waitUntil(() => sessionOf(id)?.status === "ended", TURN_TIMEOUT_MS);
    expect(await post(`/v1/sessions/${id}/compact`)).toBe(id);
    expect(sessionOf(id)?.owned).toBe(true);
    expect(compactBoundaries(id)).toBe(2);
  }, TEST_TIMEOUT_MS);

  it("answers a permission request of an owned session through the same permission route", async () => {
    cwd = makeTempDir("fd-owned-");
    daemon = await startTestDaemon({ claudeHomes: [CLAUDE_HOME], intervals: { registryPollMs: 200, transcriptPollMs: 100, pingMs: 60_000 } });
    const prompt = "Run the bash command: touch owned.txt";
    const requestedAt = Date.now();
    const id = await post("/v1/sessions/new", { cwd, prompt, worktree: false, model: TEST_MODEL, permissionMode: "default" });
    expect(Date.now() - requestedAt).toBeLessThan(START_RESPONSE_BUDGET_MS);
    expect(existsSync(join(cwd, "owned.txt"))).toBe(false);
    expect(daemon.services.activity(id, {}).items.some((item) => item.kind === "permission" && item.state === "allowed")).toBe(false);
    const pending = (): string | undefined => {
      const item = daemon?.services.activity(id, {}).items.find((entry) => entry.kind === "permission" && entry.state === "pending");
      return item?.kind === "permission" ? item.requestId : undefined;
    };
    await waitUntil(() => pending() !== undefined, TURN_TIMEOUT_MS);
    await waitUntil(() => readClaudeRegistry(CLAUDE_HOME).processes.some((entry) => entry.sessionId === id && entry.status === "waiting"), TURN_TIMEOUT_MS);
    await sleep(500);
    await expectApiOk(daemon, `/v1/sessions/${id}/permission/${pending()}`, { decision: "allow" });
    await waitUntil(() => existsSync(join(cwd, "owned.txt")), TURN_TIMEOUT_MS);
  }, TEST_TIMEOUT_MS);
});
