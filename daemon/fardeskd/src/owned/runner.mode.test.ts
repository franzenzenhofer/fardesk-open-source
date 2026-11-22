import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PermissionMode } from "../contract/schema.js";
import type { OwnedRunnerDeps } from "./runner.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { TEST_MODEL, transcriptText, useOwnedEnv, waitForIdle, waitForPending } from "../../test/support/owned.js";
import { permissionOptions } from "./opener.js";
import type { OwnedRunner } from "./types.js";

const TEST_TIMEOUT_MS = 150_000;
const TOUCH = "Run the bash command: touch mode.txt";
const OK = "Reply with the single word OK.";
const MODE_LINE = (mode: string): string => `"permissionMode":"${mode}"`;

const env = useOwnedEnv();
const startIn = async (runner: OwnedRunner, prompt: string, permissionMode?: PermissionMode): Promise<string> =>
  runner.start({ cwd: env().cwd, prompt, worktree: false, model: TEST_MODEL, ...(permissionMode === undefined ? {} : { permissionMode }) });
const touched = (): boolean => existsSync(join(env().cwd, "mode.txt"));

// Runners made here are closed again whatever the test does: a leaked claude process would fail the suite's cleanup.
async function withRunner(overrides: Partial<OwnedRunnerDeps>, work: (runner: OwnedRunner) => Promise<void>): Promise<void> {
  const runner = env().makeRunner(overrides);
  try {
    await work(runner);
  } finally {
    await runner.close();
  }
}

// The tool ran without a permission request and the transcript records the mode.
async function expectBypassRun(id: string): Promise<void> {
  await waitUntil(touched, 90_000);
  await waitForIdle(env(), id);
  expect(env().pending).toEqual([]);
  expect(transcriptText(id)).toContain(MODE_LINE("bypassPermissions"));
}

describe("permissionOptions", () => {
  it("allows skipping permissions for bypassPermissions, and for every mode where the machine allows bypass", () => {
    expect(permissionOptions("bypassPermissions", false)).toEqual({ permissionMode: "bypassPermissions", allowDangerouslySkipPermissions: true });
    expect(permissionOptions("plan", false)).toEqual({ permissionMode: "plan" });
    expect(permissionOptions("default", false)).toEqual({ permissionMode: "default" });
    expect(permissionOptions("plan", true)).toEqual({ permissionMode: "plan", allowDangerouslySkipPermissions: true });
  });
});

describe("the mode of owned sessions (real claude, haiku)", () => {
  it("runs a new session in the requested mode, even against the runner default, without asking", async () => {
    await expectBypassRun(await startIn(env().runner, TOUCH, "bypassPermissions"));
  }, TEST_TIMEOUT_MS);

  it("runs a new session without a requested mode in the runner default and still asks questions", async () => {
    await withRunner({ permissionMode: "bypassPermissions" }, async (runner) => {
      const id = await startIn(runner, TOUCH);
      await expectBypassRun(id);
      runner.send(id, "Use the AskUserQuestion tool to ask me whether I prefer tea or coffee.");
      expect((await waitForPending(env(), "question")).sessionId).toBe(id);
    });
  }, TEST_TIMEOUT_MS);

  it("resumes in the last mode of the session and asks again when that mode is default", async () => {
    const first = await startIn(env().runner, OK, "bypassPermissions");
    await waitForIdle(env(), first);
    await env().runner.stop(first);
    await withRunner({ permissionMode: "bypassPermissions", findMode: (id) => (id === first ? "default" : null) }, async (resumer) => {
      expect(await resumer.resume(first)).toBe(first);
      resumer.send(first, TOUCH);
      expect((await waitForPending(env(), "permission")).sessionId).toBe(first);
      await sleep(500);
      expect(touched()).toBe(false);
    });
  }, TEST_TIMEOUT_MS);

  it("resumes in the runner default when the transcript has no mode", async () => {
    const first = await startIn(env().runner, OK, "default");
    await waitForIdle(env(), first);
    await env().runner.stop(first);
    await withRunner({ permissionMode: "bypassPermissions", findMode: () => null }, async (resumer) => {
      await resumer.resume(first);
      resumer.send(first, TOUCH);
      await waitUntil(touched, 90_000);
      expect(env().pending).toEqual([]);
    });
  }, TEST_TIMEOUT_MS);
});
