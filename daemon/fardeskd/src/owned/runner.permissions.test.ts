import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sleep, waitUntil } from "../../test/support/env.js";
import {
  TEST_MODEL,
  transcriptLineCount,
  transcriptText,
  useOwnedEnv,
  waitForIdle,
  waitForPending,
} from "../../test/support/owned.js";
import { assistantTextSince } from "../../test/support/ownedProcs.js";

const TEST_TIMEOUT_MS = 120_000;
const LONG_TOOL = 'Run the bash command: python3 -c "import time; time.sleep(60)"';

const env = useOwnedEnv();

const startWith = async (prompt: string): Promise<string> =>
  env().runner.start({ cwd: env().cwd, prompt, worktree: false, model: TEST_MODEL });

describe("permission flow", () => {
  it("runs the tool after allow", async () => {
    const id = await startWith("Run the bash command: touch owned.txt");
    const request = await waitForPending(env(), "permission");
    expect(request.sessionId).toBe(id);
    env().broker.decide(id, request.requestId, "allow");
    await waitUntil(() => existsSync(join(env().cwd, "owned.txt")), 90_000);
    await waitForIdle(env(), id);
  }, TEST_TIMEOUT_MS);

  it("does not run the tool after deny", async () => {
    const id = await startWith("Run the bash command: touch owned.txt");
    const request = await waitForPending(env(), "permission");
    const denied = new Set<string>();
    const denyAll = (): boolean => {
      for (const pending of env().pending.filter((p) => !denied.has(p.requestId))) {
        denied.add(pending.requestId);
        env().broker.decide(id, pending.requestId, "deny");
      }
      return !env().runner.isBusy(id);
    };
    env().broker.decide(id, request.requestId, "deny");
    denied.add(request.requestId);
    await sleep(500);
    await waitUntil(denyAll, 90_000);
    expect(existsSync(join(env().cwd, "owned.txt"))).toBe(false);
  }, TEST_TIMEOUT_MS);

  it("answers an AskUserQuestion through the broker", async () => {
    const id = await startWith("Use the AskUserQuestion tool to ask me whether I prefer tea or coffee, then tell me my answer in one short sentence.");
    const request = await waitForPending(env(), "question");
    const { activity } = request;
    const option = activity.kind === "question" ? (activity.options[0] ?? "") : "";
    expect(option).not.toBe("");
    env().broker.answer(id, request.requestId, option);
    await waitForIdle(env(), id);
    expect(transcriptText(id)).toContain(option);
  }, TEST_TIMEOUT_MS);

  it("expires pending requests when the session is stopped", async () => {
    const id = await startWith("Run the bash command: touch owned.txt");
    await waitForPending(env(), "permission");
    expect(env().broker.pendingKind(id)).toBe("permission");
    await env().runner.stop(id);
    expect(env().broker.pendingKind(id)).toBeNull();
    expect(existsSync(join(env().cwd, "owned.txt"))).toBe(false);
  }, TEST_TIMEOUT_MS);
});

describe("interrupt", () => {
  it("is a no-op while idle", async () => {
    const id = await startWith("Reply with the single word OK.");
    await waitForIdle(env(), id);
    const started = Date.now();
    await env().runner.interrupt(id);
    expect(Date.now() - started).toBeLessThan(1_000);
  }, TEST_TIMEOUT_MS);

  it("stops a long tool within the timeout and the session keeps answering", async () => {
    const id = await startWith(LONG_TOOL);
    const request = await waitForPending(env(), "permission");
    env().broker.decide(id, request.requestId, "allow");
    await sleep(4_000);
    expect(env().runner.isBusy(id)).toBe(true);
    const started = Date.now();
    await env().runner.interrupt(id);
    expect(Date.now() - started).toBeLessThan(20_000);
    await waitForIdle(env(), id);
    const before = transcriptLineCount(id);
    env().runner.send(id, "Reply with the single word PONG.");
    await waitUntil(() => assistantTextSince(id, before).includes("PONG"), 90_000);
  }, TEST_TIMEOUT_MS);

  it("reports a conflict when the interrupt does not return in time", async () => {
    const impatient = env().makeRunner({ interruptTimeoutMs: 1 });
    const id = await impatient.start({ cwd: env().cwd, prompt: LONG_TOOL, worktree: false, model: TEST_MODEL });
    await waitForPending(env(), "permission");
    await expect(impatient.interrupt(id)).rejects.toMatchObject({ code: "conflict" });
    await impatient.close();
  }, TEST_TIMEOUT_MS);
});
