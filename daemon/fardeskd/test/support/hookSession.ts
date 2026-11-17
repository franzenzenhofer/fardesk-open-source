// Helpers for tests that drive the real hook command against a running test daemon.
import { readFileSync } from "node:fs";
import { buildHookCommand } from "../../src/hooks/command.js";
import { hookSocket } from "./daemon.js";
import type { TestDaemon } from "./daemon.js";
import { fixturePath, waitUntil } from "./env.js";
import { runHook } from "./hookRun.js";
import type { HookRun } from "./hookRun.js";

// The session id inside every committed hook fixture.
export const HOOK_SESSION_ID = "7d7456e7-072b-4806-8b62-9b9d858ba62a";
const HOOK_MAX_SECONDS = 20;

export function hookFixtureText(name: string): string {
  return readFileSync(fixturePath("hooks", name), "utf8");
}

export async function seedHookSession(daemon: TestDaemon, registryOverrides: Record<string, unknown> = {}): Promise<{ pid: number; transcript: string }> {
  const { path } = daemon.home.addTranscript({ fixture: "01b-minimal-session", sessionId: HOOK_SESSION_ID });
  const { pid } = daemon.home.addRegistry({ fixture: "busy", sessionId: HOOK_SESSION_ID, overrides: registryOverrides });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === HOOK_SESSION_ID));
  return { pid, transcript: path };
}

export async function fireHook(daemon: TestDaemon, fixture: string, maxSeconds = HOOK_MAX_SECONDS): Promise<HookRun> {
  return runHook(buildHookCommand(hookSocket(daemon), maxSeconds), hookFixtureText(fixture));
}

// Waits until the broker shows a pending request of that kind in the session feed and returns its request id.
export async function pendingRequestId(daemon: TestDaemon, kind: "permission" | "question"): Promise<string> {
  let requestId = "";
  await waitUntil(() => {
    for (const item of daemon.services.activity(HOOK_SESSION_ID, {}).items) {
      if ((item.kind === "permission" || item.kind === "question") && item.kind === kind && item.state === "pending") requestId = item.requestId;
    }
    return requestId !== "";
  });
  return requestId;
}
