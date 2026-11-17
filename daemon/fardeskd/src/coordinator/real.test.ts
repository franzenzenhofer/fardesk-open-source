import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { CLAUDE_HOME, TEST_MODEL, TURN_TIMEOUT_MS, moveProjectFoldersToTrash } from "../../test/support/owned.js";
import { actionResultSchema, coordinatorStateSchema } from "../contract/schema.js";
import { COORDINATOR_DIR, COORDINATOR_TITLE } from "./session.js";

const TEST_TIMEOUT_MS = 240_000;
const PROMPT = "List my sessions and reply with only the number of sessions on this machine.";
let daemon: TestDaemon | null = null;

afterEach(async () => {
  const cwd = daemon === null ? null : join(daemon.config.stateDir, COORDINATOR_DIR);
  await daemon?.close();
  daemon = null;
  if (cwd !== null) moveProjectFoldersToTrash(cwd);
});

async function ask(prompt: string): Promise<string> {
  const response = await daemon?.call("POST", "/v1/coordinator", { prompt });
  expect(response?.status).toBe(200);
  return actionResultSchema.parse(response?.json).sessionId;
}

describe("coordinator (real claude, haiku)", () => {
  it("starts an owned session titled Coordinator that calls list_sessions, and reuses it for the next prompt", async () => {
    daemon = await startTestDaemon({
      claudeHomes: [CLAUDE_HOME],
      coordinator: { enabled: true, peerTokens: {}, model: TEST_MODEL },
      intervals: { registryPollMs: 200, transcriptPollMs: 100, pingMs: 60_000 },
    });
    const state = async (): Promise<unknown> => coordinatorStateSchema.parse((await daemon?.call("GET", "/v1/coordinator"))?.json);
    expect(await state()).toEqual({ sessionId: null });
    const id = await ask(PROMPT);
    expect(await state()).toEqual({ sessionId: id });
    const items = (): ReturnType<TestDaemon["services"]["activity"]>["items"] => daemon?.services.activity(id, { limit: 200 }).items ?? [];
    const toolIndex = (): number => items().findIndex((item) => item.kind === "tool" && item.tool === "mcp__fardesk__list_sessions");
    await waitUntil(() => toolIndex() >= 0, TURN_TIMEOUT_MS);
    await waitUntil(() => items().slice(toolIndex()).some((item) => item.kind === "assistant" && item.text.trim().length > 0), TURN_TIMEOUT_MS);
    const session = daemon.services.sessions().find((candidate) => candidate.id === id);
    expect(session).toMatchObject({ owned: true, title: COORDINATOR_TITLE });
    expect(items().some((item) => item.kind === "permission")).toBe(false);
    expect(await ask("Thanks, reply with the single word OK.")).toBe(id);
  }, TEST_TIMEOUT_MS);
});
