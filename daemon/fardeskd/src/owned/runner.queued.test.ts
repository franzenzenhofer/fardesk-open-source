import { describe, expect, it } from "vitest";
import { sleep, waitUntil } from "../../test/support/env.js";
import { TEST_MODEL, transcriptLineCount, transcriptText, useOwnedEnv, waitForIdle, waitForTranscript } from "../../test/support/owned.js";

const TEST_TIMEOUT_MS = 180_000;
const LONG_PROMPT = "Write the integers from 1 to 150, one per line, then on a last line the word ALPHA.";
const IDLE_TIMEOUT_MS = 90_000;

const env = useOwnedEnv();

describe("a second message while a turn runs", () => {
  it("leaves the session idle again once Claude Code has answered both", async () => {
    const id = await env().runner.start({ cwd: env().cwd, prompt: LONG_PROMPT, worktree: false, model: TEST_MODEL });
    await waitForTranscript(id, '"type":"assistant"');
    expect(env().runner.isBusy(id)).toBe(true);
    const before = transcriptLineCount(id);
    env().runner.send(id, "After that, reply with the single word BRAVO.");
    await waitUntil(() => transcriptText(id).includes("BRAVO") && transcriptLineCount(id) > before, IDLE_TIMEOUT_MS);
    await sleep(2_000);
    await waitForIdle(env(), id);
    expect(env().runner.isBusy(id)).toBe(false);
  }, TEST_TIMEOUT_MS);
});
