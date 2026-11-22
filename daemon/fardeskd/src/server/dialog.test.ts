import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { startFakeOwned } from "../../test/support/fakeOwned.js";
import type { TestDaemon, TestStream } from "../../test/support/daemon.js";
import { makeTempDir, waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID } from "../../test/support/hookSession.js";
import { activitySchema } from "../contract/schema.js";
import type { Activity } from "../contract/schema.js";

const FAKE_CLAUDE = fileURLToPath(new URL("../../test/support/fakeDialogClaude.mjs", import.meta.url));
const COLD = "cold_resume_quota";
const PAYLOAD = { inactiveSince: 1795338000000, contextTokens: 182000, percentOfFiveHourLimit: 14, trigger: "resume", focusedAction: "resume", offersLookUp: false, offersSummary: true };
const PAYLOAD_NO_SUMMARY = { ...PAYLOAD, offersSummary: false };
const SESSION_ID = HOOK_SESSION_ID;

type Dialog = { id: string; kind: string; payload: Record<string, unknown>; cancelAfterMs?: number };
type DialogActivity = Extract<Activity, { kind: "dialog" }>;

let daemon: TestDaemon | null = null;
let stream: TestStream | null = null;
let logPath = "";

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  delete process.env["FAKE_DIALOGS"];
  delete process.env["FAKE_DIALOG_LOG"];
  delete process.env["FAKE_SESSION_ID"];
});

async function boot(dialogs: Dialog[]): Promise<TestDaemon> {
  logPath = join(makeTempDir("fd-dialog-"), "cli.jsonl");
  process.env["FAKE_DIALOGS"] = JSON.stringify(dialogs);
  process.env["FAKE_DIALOG_LOG"] = logPath;
  process.env["FAKE_SESSION_ID"] = SESSION_ID;
  daemon = await startFakeOwned({ claudeBinary: FAKE_CLAUDE }, { prompt: "hello" }, SESSION_ID, async (started) => {
    stream = await started.openStream();
  });
  return daemon;
}

const cliLines = (): Record<string, unknown>[] => readFileSync(logPath, "utf8").split("\n").filter((line) => line !== "").map((line) => JSON.parse(line) as Record<string, unknown>);

/** What the fake CLI received as the answer to one of its control requests. */
function cliAnswer(requestId: string): unknown {
  const reply = cliLines().find((line) => line["type"] === "control_response" && (line["response"] as { request_id?: string }).request_id === requestId);
  return reply === undefined ? undefined : (reply["response"] as { response: unknown }).response;
}

const dialogEvents = (): DialogActivity[] =>
  (stream?.events ?? []).flatMap((event) => (event.type === "activity" && event.activity.kind === "dialog" ? [event.activity] : []));

const dialogOf = (requestId: string, state: string): DialogActivity | undefined => dialogEvents().find((a) => a.requestId === requestId && a.state === state);

async function firstPending(): Promise<DialogActivity> {
  await waitUntil(() => dialogEvents().some((a) => a.state === "pending"));
  const found = dialogEvents().find((a) => a.state === "pending");
  if (found === undefined) throw new Error("unreachable");
  return found;
}

const answerPath = (requestId: string): string => `/v1/sessions/${SESSION_ID}/dialog/${requestId}`;

describe("Claude Code dialogs passed through (fake claude)", () => {
  it("declares the supported kinds, lists the dialog, and gives the answer back to Claude Code", async () => {
    const d = await boot([{ id: "dlg-1", kind: COLD, payload: PAYLOAD }]);
    const initialize = cliLines().find((line) => (line["request"] as { subtype?: string } | undefined)?.subtype === "initialize");
    expect((initialize?.["request"] as { supportedDialogKinds: string[] }).supportedDialogKinds).toEqual([COLD]);

    const pending = await firstPending();
    expect(pending).toMatchObject({ kind: "dialog", dialogKind: COLD, payload: PAYLOAD, choices: ["resume", "new_conversation", "compact", "dismiss"], state: "pending" });
    activitySchema.parse(pending);
    const listed = d.services.activity(SESSION_ID, {}).items.find((item) => item.kind === "dialog");
    expect(listed).toMatchObject({ requestId: pending.requestId, state: "pending" });

    const response = await d.call("POST", answerPath(pending.requestId), { answer: "compact" });
    expect(response).toMatchObject({ status: 200, json: { ok: true } });
    await waitUntil(() => cliAnswer("dlg-1") !== undefined);
    expect(cliAnswer("dlg-1")).toEqual({ behavior: "completed", result: "compact" });
    await waitUntil(() => dialogOf(pending.requestId, "answered") !== undefined);
  });

  it("leaves out compact when Claude Code offers no summary, and refuses a wrong or a second answer", async () => {
    const d = await boot([{ id: "dlg-1", kind: COLD, payload: PAYLOAD_NO_SUMMARY }]);
    const pending = await firstPending();
    expect(pending.choices).toEqual(["resume", "new_conversation", "dismiss"]);
    expect((await d.call("POST", answerPath(pending.requestId), { answer: "compact" })).status).toBe(400);
    expect((await d.call("POST", answerPath(pending.requestId), { answer: "" })).status).toBe(400);
    expect(cliAnswer("dlg-1")).toBeUndefined();

    expect((await d.call("POST", answerPath(pending.requestId), { answer: "dismiss" })).status).toBe(200);
    await waitUntil(() => cliAnswer("dlg-1") !== undefined);
    expect(cliAnswer("dlg-1")).toEqual({ behavior: "completed", result: "dismiss" });
    expect((await d.call("POST", answerPath(pending.requestId), { answer: "resume" })).status).toBe(404);
    expect((await d.call("POST", answerPath("req-unknown"), { answer: "resume" })).status).toBe(404);
  });

  it("cancels an unknown dialog kind at once and shows nothing for it", async () => {
    await boot([{ id: "dlg-1", kind: "mystery_dialog", payload: { a: 1 } }]);
    await waitUntil(() => cliAnswer("dlg-1") !== undefined);
    expect(cliAnswer("dlg-1")).toEqual({ behavior: "cancelled" });
    expect(dialogEvents()).toEqual([]);
  });

  it("expires a dialog that Claude Code withdraws", async () => {
    await boot([{ id: "dlg-1", kind: COLD, payload: PAYLOAD, cancelAfterMs: 300 }]);
    const pending = await firstPending();
    await waitUntil(() => dialogOf(pending.requestId, "expired") !== undefined);
    expect(cliAnswer("dlg-1")).not.toMatchObject({ behavior: "completed" });
  });
});
