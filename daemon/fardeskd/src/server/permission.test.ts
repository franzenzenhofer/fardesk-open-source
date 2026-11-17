import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon, TestStream } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { HOOK_SESSION_ID, fireHook, pendingRequestId, seedHookSession } from "../../test/support/hookSession.js";
import type { HookRun } from "../../test/support/hookRun.js";
import { okResultSchema } from "../contract/schema.js";

let daemon: TestDaemon;
let stream: TestStream;
let terminalPid = 0;

async function boot(configOverrides: Record<string, unknown> = {}, registry: Record<string, unknown> = {}): Promise<void> {
  daemon = await startTestDaemon(configOverrides);
  terminalPid = (await seedHookSession(daemon, registry)).pid;
  stream = await daemon.openStream();
}

beforeEach(async () => {
  await boot();
});

afterEach(async () => {
  await daemon.close();
});

const requestStates = (kind: string): string[] =>
  stream.events.flatMap((event) =>
    event.type === "activity" && event.activity.kind === kind && "state" in event.activity ? [event.activity.state] : [],
  );

function decision(run: HookRun): { behavior: string; [key: string]: unknown } {
  const output = JSON.parse(run.stdout) as { hookSpecificOutput: { hookEventName: string; decision: { behavior: string } } };
  expect(output.hookSpecificOutput.hookEventName).toBe("PermissionRequest");
  return output.hookSpecificOutput.decision;
}

async function answerWith(path: (requestId: string) => string, body: unknown, kind: "permission" | "question", fixture: string): Promise<HookRun> {
  const hook = fireHook(daemon, fixture);
  const requestId = await pendingRequestId(daemon, kind);
  await waitUntil(() => requestStates(kind).includes("pending"));
  const response = await daemon.call("POST", path(requestId), body);
  expect(response.status).toBe(200);
  expect(okResultSchema.parse(response.json)).toEqual({ ok: true });
  return hook;
}

const permissionPath = (requestId: string): string => `/v1/sessions/${HOOK_SESSION_ID}/permission/${requestId}`;
const answerPath = (requestId: string): string => `/v1/sessions/${HOOK_SESSION_ID}/answer/${requestId}`;

describe("permission round trip through the real hook command", () => {
  it("shows the request as pending, then allows it", async () => {
    const run = await answerWith(permissionPath, { decision: "allow" }, "permission", "PermissionRequest-bash.json");
    expect(run.code).toBe(0);
    expect(decision(run)).toEqual({ behavior: "allow" });
    await waitUntil(() => requestStates("permission").includes("allowed"));
    expect(requestStates("permission")).toEqual(["pending", "allowed"]);
    expect(daemon.services.sessions().find((session) => session.id === HOOK_SESSION_ID)?.status).toBe("working");
  });

  it("marks the session as waiting while the request is pending", async () => {
    const hook = fireHook(daemon, "PermissionRequest-bash.json");
    const requestId = await pendingRequestId(daemon, "permission");
    const summary = (): { status: string; waitingFor: string | null; summary: string } | undefined =>
      daemon.services.sessions().find((session) => session.id === HOOK_SESSION_ID);
    await waitUntil(() => summary()?.status === "waiting");
    expect(summary()).toMatchObject({ waitingFor: "permission", summary: "Needs approval" });
    await daemon.call("POST", permissionPath(requestId), { decision: "deny" });
    await hook;
    await waitUntil(() => summary()?.status === "working");
  });

  it("denies a request", async () => {
    const run = await answerWith(permissionPath, { decision: "deny" }, "permission", "PermissionRequest-bash.json");
    expect(decision(run)).toMatchObject({ behavior: "deny", message: "Denied from Fardesk" });
    await waitUntil(() => requestStates("permission").includes("denied"));
  });

  it("allows always with a session-scoped rule", async () => {
    const run = await answerWith(permissionPath, { decision: "allow_always" }, "permission", "PermissionRequest-bash.json");
    const verdict = decision(run);
    expect(verdict.behavior).toBe("allow");
    expect(JSON.stringify(verdict["updatedPermissions"])).toContain('"destination":"session"');
  });

  it("answers a question", async () => {
    const run = await answerWith(answerPath, { option: "Tea" }, "question", "PermissionRequest-askuserquestion.json");
    const verdict = decision(run) as { behavior: string; updatedInput?: { answers: Record<string, string> } };
    expect(verdict.behavior).toBe("allow");
    expect(Object.values(verdict.updatedInput?.answers ?? {})).toEqual(["Tea"]);
    await waitUntil(() => requestStates("question").includes("answered"));
  });

  it("rejects an option that is not offered and keeps the request pending", async () => {
    const hook = fireHook(daemon, "PermissionRequest-askuserquestion.json");
    const requestId = await pendingRequestId(daemon, "question");
    expect((await daemon.call("POST", answerPath(requestId), { option: "Cocoa" })).status).toBe(400);
    expect((await daemon.call("POST", permissionPath(requestId), { decision: "allow" })).status).toBe(400);
    await daemon.call("POST", answerPath(requestId), { option: "Coffee" });
    expect(decision(await hook).behavior).toBe("allow");
  });
});

describe("requests nobody answers", () => {
  it("expires after the permission timeout and the hook prints nothing", async () => {
    await daemon.close();
    await boot({ permissionTimeoutSeconds: 1 });
    const run = await fireHook(daemon, "PermissionRequest-bash.json");
    expect(run).toMatchObject({ code: 0, stdout: "" });
    await waitUntil(() => requestStates("permission").includes("expired"));
    expect((await daemon.call("POST", permissionPath("whatever"), { decision: "allow" })).status).toBe(404);
  });

  it("expires when the terminal user answers first (registry leaves waiting)", async () => {
    await daemon.close();
    await boot({}, { status: "waiting" });
    const hook = fireHook(daemon, "PermissionRequest-bash.json");
    await pendingRequestId(daemon, "permission");
    daemon.home.addRegistry({ fixture: "busy", sessionId: HOOK_SESSION_ID, pid: terminalPid, overrides: { status: "busy" } });
    const run = await hook;
    expect(run).toMatchObject({ code: 0, stdout: "" });
    expect(requestStates("permission")).toEqual(["pending", "expired"]);
  });
});
