import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { waitUntil } from "../../test/support/env.js";
import { CLAUDE_HOME, TEST_MODEL, transcriptLineCount, transcriptText, useOwnedEnv, waitForIdle, waitForTranscript } from "../../test/support/owned.js";
import { assistantTextSince, holderPids, makeGitRepo, spawnForeign } from "../../test/support/ownedProcs.js";
import { waitForRelease } from "./lock.js";
import { createStateFile } from "./stateFile.js";

const TEST_TIMEOUT_MS = 120_000;
const SECRET_PROMPT = "Remember the secret word KUMQUAT. Reply with the single word OK.";
const ASK_SECRET = "What was the secret word? Reply with that word only.";

const env = useOwnedEnv();

async function startSecretSession(): Promise<string> {
  const id = await env().runner.start({ cwd: env().cwd, prompt: SECRET_PROMPT, worktree: false, model: TEST_MODEL });
  await waitForTranscript(id, '"type":"assistant"');
  await waitForIdle(env(), id);
  return id;
}

async function expectSecretAnswered(id: string): Promise<void> {
  const before = transcriptLineCount(id);
  env().runner.send(id, ASK_SECRET);
  await waitUntil(() => assistantTextSince(id, before).includes("KUMQUAT"), 90_000);
}

describe("lock and takeover", () => {
  it("refuses resume while a terminal process holds the session, takeover ends it and resumes", async () => {
    const id = await startSecretSession();
    await env().runner.stop(id);
    const foreign = await spawnForeign(env().cwd, id);
    await expect(env().runner.resume(id)).rejects.toMatchObject({ code: "conflict" });
    await expect(waitForRelease(CLAUDE_HOME, id, { timeoutMs: 300, pollMs: 50 })).rejects.toMatchObject({ code: "conflict" });
    expect(await env().runner.takeover(id)).toBe(id);
    await foreign.exited;
    expect(env().runner.isOwned(id)).toBe(true);
    expect(await env().runner.takeover(id)).toBe(id);
    await expectSecretAnswered(id);
    expect(holderPids(id)).toHaveLength(1);
    expect(holderPids(id)).not.toContain(foreign.pid);
  }, TEST_TIMEOUT_MS);
});

describe("fork", () => {
  it("branches into a new owned session and leaves the original transcript unchanged", async () => {
    const id = await startSecretSession();
    const originalLines = transcriptLineCount(id);
    const copy = await env().runner.fork(id);
    expect(copy).not.toBe(id);
    expect(env().runner.isOwned(copy)).toBe(true);
    expect(env().runner.isOwned(id)).toBe(true);
    await expectSecretAnswered(copy);
    await waitForIdle(env(), copy);
    expect(transcriptLineCount(id)).toBe(originalLines);
  }, TEST_TIMEOUT_MS);
});

describe("persistence", () => {
  it("restores owned sessions after a restart and keeps their state entries on close", async () => {
    const id = await startSecretSession();
    await env().runner.close();
    expect(statSync(env().statePath).mode & 0o777).toBe(0o600);
    const second = env().makeRunner();
    await second.restore();
    expect(second.isOwned(id)).toBe(true);
    const before = transcriptLineCount(id);
    second.send(id, ASK_SECRET);
    await waitUntil(() => assistantTextSince(id, before).includes("KUMQUAT"), 90_000);
    await second.close();
  }, TEST_TIMEOUT_MS);

  it("drops entries whose transcript is gone or that a terminal process holds", async () => {
    const id = await startSecretSession();
    await env().runner.close();
    const foreign = await spawnForeign(env().cwd, id);
    const orphan = { sessionId: "00000000-0000-4000-8000-000000000000", cwd: env().cwd, model: null };
    const entries = [{ sessionId: id, cwd: env().cwd, model: TEST_MODEL }, orphan];
    createStateFile(env().statePath).write(entries);
    const second = env().makeRunner();
    await second.restore();
    expect(second.isOwned(id)).toBe(false);
    expect(createStateFile(env().statePath).read()).toEqual([]);
    expect(env().logs.join("\n")).toContain("transcript is gone");
    expect(env().logs.join("\n")).toContain("cannot resume");
    foreign.child.kill("SIGTERM");
    await foreign.exited;
  }, TEST_TIMEOUT_MS);

  it("fails loudly on a corrupt state file", async () => {
    writeFileSync(env().statePath, "{not json");
    await expect(env().makeRunner().restore()).rejects.toMatchObject({ code: "internal" });
  });
});

describe("worktree", () => {
  it("passes --worktree to the CLI so the session runs in a git worktree", async () => {
    makeGitRepo(env().cwd);
    const id = await env().runner.start({ cwd: env().cwd, prompt: "Reply with the single word OK.", worktree: true, model: TEST_MODEL });
    await waitForTranscript(id, '"type":"assistant"');
    const worktrees = join(env().cwd, ".claude", "worktrees");
    expect(existsSync(worktrees)).toBe(true);
    expect(readdirSync(worktrees).length).toBeGreaterThan(0);
    expect(transcriptText(id)).toContain("worktrees");
  }, TEST_TIMEOUT_MS);
});
