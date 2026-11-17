import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { waitUntil } from "../../test/support/env.js";
import {
  CLAUDE_HOME,
  TEST_MODEL,
  transcriptLineCount,
  transcriptText,
  useOwnedEnv,
  waitForIdle,
  waitForTranscript,
} from "../../test/support/owned.js";
import { assistantTextSince, holderPids } from "../../test/support/ownedProcs.js";
import { readClaudeRegistry } from "../sessions/claudeRegistry.js";
import { createStateFile } from "./stateFile.js";

const TEST_TIMEOUT_MS = 120_000;
const OK_PROMPT = "Reply with the single word OK.";

const env = useOwnedEnv();

const startOk = async (prompt = OK_PROMPT): Promise<string> =>
  env().runner.start({ cwd: env().cwd, prompt, worktree: false, model: TEST_MODEL });

describe("start and send", () => {
  it("starts a session, records the prompt and a reply, answers a second message", async () => {
    const id = await startOk();
    expect(env().runner.isOwned(id)).toBe(true);
    await waitForTranscript(id, '"type":"assistant"');
    expect(transcriptText(id)).toContain(OK_PROMPT);
    await waitForIdle(env(), id);
    const before = transcriptLineCount(id);
    env().runner.send(id, "Reply with the single word PINEAPPLE.");
    expect(env().runner.isBusy(id)).toBe(true);
    await waitUntil(() => assistantTextSince(id, before).includes("PINEAPPLE"), 90_000);
    await waitForIdle(env(), id);
    expect(env().runner.isBusy(id)).toBe(false);
    expect(createStateFile(env().statePath).read()).toEqual([{ sessionId: id, cwd: env().cwd, model: TEST_MODEL }]);
  }, TEST_TIMEOUT_MS);

  it("rejects a missing directory and unknown ids", async () => {
    const missing = { cwd: `${env().cwd}/missing`, prompt: "x", worktree: false, model: null };
    await expect(env().runner.start(missing)).rejects.toMatchObject({ code: "invalid_request" });
    expect(() => {
      env().runner.send("nope", "x");
    }).toThrow(FardeskError);
    await expect(env().runner.stop("nope")).rejects.toMatchObject({ code: "not_found" });
    await expect(env().runner.interrupt("nope")).rejects.toMatchObject({ code: "not_found" });
    expect(env().runner.isOwned("nope")).toBe(false);
    expect(env().runner.isBusy("nope")).toBe(false);
  });

  it("fails start loudly when claude cannot run", async () => {
    const broken = env().makeRunner({ claudeBinary: `${env().cwd}/no-such-claude` });
    const request = { cwd: env().cwd, prompt: "x", worktree: false, model: "default" };
    await expect(broken.start(request)).rejects.toMatchObject({ code: "internal" });
    expect(env().logs.join("\n")).toContain("owned session stream failed");
  });
});

describe("stop, resume and stream end", () => {
  it("keeps the history across stop and resume, and resume is idempotent", async () => {
    const id = await startOk("Remember the secret word MANGOSTEEN. Reply with the single word OK.");
    await waitForTranscript(id, '"type":"assistant"');
    await waitForIdle(env(), id);
    await env().runner.stop(id);
    expect(env().runner.isOwned(id)).toBe(false);
    expect(holderPids(id)).toEqual([]);
    expect(createStateFile(env().statePath).read()).toEqual([]);
    expect(await env().runner.resume(id)).toBe(id);
    expect(await env().runner.resume(id)).toBe(id);
    const before = transcriptLineCount(id);
    env().runner.send(id, "What was the secret word? Reply with that word only.");
    await waitUntil(() => assistantTextSince(id, before).includes("MANGOSTEEN"), 90_000);
  }, TEST_TIMEOUT_MS);

  it("drops a session from the owned set when its claude process dies", async () => {
    const id = await startOk();
    await waitForIdle(env(), id);
    const [pid] = holderPids(id);
    expect(pid).toBeDefined();
    process.kill(pid ?? 0, "SIGKILL");
    await waitUntil(() => !env().runner.isOwned(id), 30_000);
    expect(createStateFile(env().statePath).read()).toEqual([]);
    expect(readClaudeRegistry(CLAUDE_HOME).processes.some((p) => p.sessionId === id)).toBe(false);
  }, TEST_TIMEOUT_MS);
});
