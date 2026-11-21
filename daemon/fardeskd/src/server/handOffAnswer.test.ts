// A request that timed out stays visible with its question, and from the phone it can be answered by typing into the terminal dialog.
// Real daemon, real broker (1 s window), real hook command, real private tmux server, real local APNs server.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sleep, waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID, hookFixtureText } from "../../test/support/hookSession.js";
import { hookSocket, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { createTestApnsClient, startApnsServer } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { runHook } from "../../test/support/hookRun.js";
import { createTmuxSandbox } from "../../test/support/terminals.js";
import type { TmuxSandbox } from "../../test/support/terminals.js";
import type { Activity } from "../contract/schema.js";
import { createLogger } from "../core/log.js";
import { buildHookCommand } from "../hooks/command.js";
import { HAND_OFF_LEAD } from "../push/notifier.js";

const DEVICE = { apnsToken: "ef".repeat(32), environment: "sandbox", name: "iPhone", notifications: ["done", "permission", "question"] };
const QUESTION = "Do you prefer tea or coffee?";

let daemon: TestDaemon;
let sandbox: TmuxSandbox;
let apns: ApnsTestServer;
let typed = "";
let panePid = 0;

beforeEach(async () => {
  sandbox = createTmuxSandbox();
  apns = await startApnsServer();
  daemon = await startTestDaemon(
    { permissionTimeoutSeconds: 1, push: { content: "full" }, tmuxBinary: sandbox.binary, intervals: { registryPollMs: 100, transcriptPollMs: 50, pingMs: 60_000, typablePollMs: 150 } },
    { apns: createTestApnsClient(apns), log: createLogger(() => undefined, () => new Date()), doneDelayMs: 0 },
  );
  await daemon.call("POST", "/v1/devices", DEVICE);
  typed = join(daemon.config.stateDir, "typed.txt");
  panePid = sandbox.start(`sh -c 'while IFS= read -r line; do printf "%s\\n" "$line" >> ${typed}; done; true'`).panePid;
  daemon.home.addTranscript({ fixture: "01b-minimal-session", sessionId: HOOK_SESSION_ID });
  setRegistry("waiting");
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === HOOK_SESSION_ID));
});

afterEach(async () => {
  await daemon.close();
  await apns.stop();
  sandbox.dispose();
});

function setRegistry(status: string): void {
  daemon.home.addRegistry({ fixture: "busy", sessionId: HOOK_SESSION_ID, pid: panePid, overrides: { status } });
}

const summary = (): { waitingFor: string | null; status: string } | undefined => daemon.services.sessions().find((session) => session.id === HOOK_SESSION_ID);

type Request = Extract<Activity, { kind: "question" | "permission" }>;
const openRequest = (): Request | undefined =>
  daemon.services.activity(HOOK_SESSION_ID, {}).items.find((item): item is Request => (item.kind === "question" || item.kind === "permission") && item.state !== "expired");

const typedText = (): string => readFileSync(typed, { encoding: "utf8", flag: "a+" });
const alerts = (): { body: string; category: string }[] =>
  apns.requests.map((request) => {
    const { aps } = JSON.parse(request.body) as { aps: { alert: { body: string }; category: string } };
    return { body: aps.alert.body, category: aps.category };
  });

async function handOff(fixture: string, edit: (input: Record<string, unknown>) => void = () => undefined): Promise<Request> {
  const payload = JSON.parse(hookFixtureText(fixture)) as Record<string, unknown> & { tool_input: Record<string, unknown> };
  edit(payload.tool_input);
  const run = await runHook(buildHookCommand(hookSocket(daemon), 20), JSON.stringify(payload));
  expect(run).toMatchObject({ code: 0, stdout: "" });
  await waitUntil(() => openRequest()?.state === "terminal" && openRequest()?.typable !== undefined);
  await waitUntil(() => summary()?.waitingFor === "terminal");
  return openRequest() as Request;
}

describe("a question that timed out", () => {
  it("names the question in both pushes and keeps it with its options in the session", async () => {
    const request = await handOff("PermissionRequest-askuserquestion.json");
    await waitUntil(() => alerts().length === 2);
    expect(alerts()[0]).toEqual({ category: "QUESTION", body: QUESTION });
    expect(alerts()[1]).toEqual({ category: "TERMINAL", body: `${HAND_OFF_LEAD}: ${QUESTION}` });
    expect(request).toMatchObject({ kind: "question", text: QUESTION, options: ["Tea", "Coffee"], state: "terminal", typable: true });
    expect(summary()).toMatchObject({ status: "waiting", waitingFor: "terminal" });
  });

  it("types the option number into the dialog on a tap, and the wait clears with the registry", async () => {
    const request = await handOff("PermissionRequest-askuserquestion.json");
    const answer = daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/answer/${request.requestId}`, { option: "Coffee" });
    await waitUntil(() => typedText() === "2\n");
    setRegistry("busy");
    expect((await answer).status).toBe(200);
    await waitUntil(() => summary()?.waitingFor === null);
    await waitUntil(() => openRequest() === undefined);
    expect(typedText()).toBe("2\n");
  });

  it("refuses an option that is not in the dialog without typing anything", async () => {
    const request = await handOff("PermissionRequest-askuserquestion.json");
    const response = await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/answer/${request.requestId}`, { option: "Cocoa" });
    expect(response.status).toBe(400);
    await sleep(100);
    expect(typedText()).toBe("");
  });

  it("offers no buttons for a dialog shape it does not know, and types nothing", async () => {
    const request = await handOff("PermissionRequest-askuserquestion.json", (input) => {
      const [first] = input["questions"] as Record<string, unknown>[];
      input["questions"] = [first, { ...first, question: "And a snack?" }];
    });
    expect(request).toMatchObject({ kind: "question", state: "terminal", typable: false });
    const response = await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/answer/${request.requestId}`, { option: "Tea" });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.json)).toContain("at the computer");
    await sleep(100);
    expect(typedText()).toBe("");
  });
});

describe("a permission that timed out", () => {
  it("names the tool in the hand-off push and types the allow key on Allow", async () => {
    const request = await handOff("PermissionRequest-bash.json");
    await waitUntil(() => alerts().length === 2);
    expect(alerts()[1]).toEqual({ category: "TERMINAL", body: `${HAND_OFF_LEAD}: Bash: touch a1.txt` });
    expect(request).toMatchObject({ kind: "permission", state: "terminal", typable: true });
    const decision = daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/permission/${request.requestId}`, { decision: "allow" });
    await waitUntil(() => typedText() === "1\n");
    setRegistry("busy");
    expect((await decision).status).toBe(200);
    await waitUntil(() => openRequest() === undefined);
  });

  it("does not type Always allow: its key depends on the dialog", async () => {
    const request = await handOff("PermissionRequest-bash.json");
    const response = await daemon.call("POST", `/v1/sessions/${HOOK_SESSION_ID}/permission/${request.requestId}`, { decision: "allow_always" });
    expect(response.status).toBe(409);
    await sleep(100);
    expect(typedText()).toBe("");
  });

  it("is gone from the session as soon as the registry leaves waiting", async () => {
    await handOff("PermissionRequest-bash.json");
    setRegistry("busy");
    await waitUntil(() => openRequest() === undefined);
    await waitUntil(() => summary()?.waitingFor === null);
  });
});
