import { describe, expect, it } from "vitest";
import { waitUntil } from "../../test/support/env.js";
import { TEST_MODEL, startIdleSession, transcriptPath, transcriptText, useOwnedEnv, waitForIdle, waitForTranscript } from "../../test/support/owned.js";
import { createStateFile } from "./stateFile.js";

const TEST_TIMEOUT_MS = 240_000;
const env = useOwnedEnv();

describe("clear (real claude, haiku)", () => {
  it("re-keys the owned session to the new session id and keeps it usable", async () => {
    const id = await startIdleSession(env());

    const next = await env().runner.clear(id);

    expect(next).not.toBe(id);
    expect(env().runner.isOwned(next)).toBe(true);
    expect(env().runner.isOwned(id)).toBe(false);
    expect(createStateFile(env().statePath).read()).toEqual([{ sessionId: next, cwd: env().cwd, model: TEST_MODEL }]);
    await waitForIdle(env(), next);
    expect(env().runner.isBusy(next)).toBe(false);

    env().runner.send(next, "Reply with the single word PINEAPPLE.");
    await waitUntil(() => {
      try {
        return transcriptPath(next).length > 0;
      } catch {
        return false;
      }
    }, 90_000);
    await waitForTranscript(next, "PINEAPPLE");
    await waitForIdle(env(), next);
    expect(transcriptPath(next)).not.toBe(transcriptPath(id));
  }, TEST_TIMEOUT_MS);

  it("rejects an unknown session", async () => {
    await expect(env().runner.clear("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("compact (real claude, haiku)", () => {
  it("resolves at the compact boundary, keeps the session id and stays usable", async () => {
    const id = await startIdleSession(env());
    env().runner.send(id, "Name three fruits in one short sentence.");
    await waitForIdle(env(), id);

    await env().runner.compact(id);

    expect(env().runner.isOwned(id)).toBe(true);
    expect(transcriptText(id)).toContain('"subtype":"compact_boundary"');
    await waitForIdle(env(), id);
    expect(env().runner.isBusy(id)).toBe(false);
    env().runner.send(id, "Reply with the single word PINEAPPLE.");
    await waitForTranscript(id, "PINEAPPLE");
    await waitForIdle(env(), id);
  }, TEST_TIMEOUT_MS);

  it("rejects an unknown session", async () => {
    await expect(env().runner.compact("nope")).rejects.toMatchObject({ code: "not_found" });
  });
});
