// A daemon whose owned sessions run the fake Claude CLI (fakeDialogClaude.mjs), with one session started and listed.
import { expect } from "vitest";
import { actionResultSchema } from "../../src/contract/schema.js";
import { startTestDaemon } from "./daemon.js";
import type { TestDaemon } from "./daemon.js";
import { makeTempDir, waitUntil } from "./env.js";

/**
 * Starts the daemon, runs `beforeSession` (for example to open the event stream before anything happens), opens one
 * owned session with `request` and waits until it is listed under `sessionId`.
 */
export async function startFakeOwned(
  config: Record<string, unknown>,
  request: Record<string, unknown>,
  sessionId: string,
  beforeSession: (daemon: TestDaemon) => Promise<void> = () => Promise.resolve(),
): Promise<TestDaemon> {
  const daemon = await startTestDaemon(config);
  await beforeSession(daemon);
  const response = await daemon.call("POST", "/v1/sessions/new", { cwd: makeTempDir("fd-cwd-"), worktree: false, model: null, ...request });
  expect(response.status).toBe(200);
  expect(actionResultSchema.parse(response.json).sessionId).toBe(sessionId);
  daemon.home.addTranscript({ fixture: "01b-minimal-session", sessionId });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  return daemon;
}
