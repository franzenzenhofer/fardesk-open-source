import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { machineSchema, sessionSummarySchema } from "../contract/schema.js";

const WORK_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const OTHER_ID = "bbbbbbbb-2222-4222-8222-222222222222";
let daemon: TestDaemon | null = null;
const extraHomes: ClaudeHome[] = [];

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  for (const home of extraHomes.splice(0)) home.dispose();
});

async function startWithTwoHomes(): Promise<TestDaemon> {
  const work = createClaudeHome();
  const other = createClaudeHome();
  extraHomes.push(work, other);
  work.addTranscript({ fixture: "01-simple-session", sessionId: WORK_ID });
  work.addRegistry({ fixture: "idle", sessionId: WORK_ID });
  other.addTranscript({ fixture: "01-simple-session", sessionId: OTHER_ID });
  other.addRegistry({ fixture: "idle", sessionId: OTHER_ID });
  daemon = await startTestDaemon({ claudeHomes: [{ path: work.dir, name: "work" }, { path: other.dir, name: "other" }] });
  return daemon;
}

describe("two Claude homes through the HTTP API (#61)", () => {
  it("lists the home names in /v1/machine and the home name, never the path, on every session", async () => {
    const running = await startWithTwoHomes();
    expect(machineSchema.parse((await running.call("GET", "/v1/machine")).json).homes).toEqual(["work", "other"]);
    await waitUntil(() => running.services.sessions().length === 2);
    const response = await running.call("GET", "/v1/sessions");
    const sessions = (response.json as unknown[]).map((raw) => sessionSummarySchema.parse(raw));
    expect(new Map(sessions.map((session) => [session.id, session.home]))).toEqual(new Map([[WORK_ID, "work"], [OTHER_ID, "other"]]));
    expect(JSON.stringify(response.json)).not.toContain(extraHomes[0]?.dir ?? "no-dir");
  });

  it("refuses a new session for an unknown home with invalid_request and starts nothing", async () => {
    const running = await startWithTwoHomes();
    const response = await running.call("POST", "/v1/sessions/new", { cwd: running.config.stateDir, prompt: "hi", worktree: false, model: null, home: "nowhere" });
    expect(response.status).toBe(400);
    expect(response.json).toMatchObject({ error: { code: "invalid_request" } });
    expect(running.services.sessions().map((session) => session.id).sort()).toEqual([WORK_ID, OTHER_ID]);
  });
});
