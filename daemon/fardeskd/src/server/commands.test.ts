import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectApiError, expectApiKilled, expectApiOk, expectStopSendsEscape } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { startInbox } from "../../test/support/inboxServer.js";
import type { InboxServer } from "../../test/support/inboxServer.js";

import { messageResultSchema } from "../contract/schema.js";
import { isProcessAlive } from "../sessions/processes.js";

const PROMPTING = "02-interrupt-denied-bash-error";
let daemon: TestDaemon;
const inboxes: InboxServer[] = [];
const tmuxSessions: string[] = [];

beforeEach(async () => {
  daemon = await startTestDaemon();
});

afterEach(async () => {
  await daemon.close();
  for (const inbox of inboxes.splice(0)) await inbox.close();
  for (const name of tmuxSessions.splice(0)) {
    try {
      execFileSync(daemon.config.tmuxBinary, ["kill-session", "-t", name], { stdio: "ignore" });
    } catch {
      // the pane already exited
    }
  }
});

type Seeded = { id: string; pid: number; transcript: string };

async function seed(overrides: Record<string, unknown> = {}, fixture = "01b-minimal-session"): Promise<Seeded> {
  const { sessionId, path } = daemon.home.addTranscript({ fixture });
  const { pid } = daemon.home.addRegistry({ fixture: "busy", sessionId, overrides });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  return { id: sessionId, pid, transcript: path };
}

describe("mute and devices", () => {
  it("mutes a session, persists it and shows it in the list", async () => {
    const { id } = await seed();
    await expectApiOk(daemon, `/v1/sessions/${id}/mute`, { muted: true });
    expect(daemon.services.sessions().find((session) => session.id === id)?.muted).toBe(true);
    expect(JSON.parse(readFileSync(join(daemon.config.stateDir, "mutes.json"), "utf8"))).toEqual({ muted: [id] });
    await expectApiOk(daemon, `/v1/sessions/${id}/mute`, { muted: false });
    expect(daemon.services.sessions().find((session) => session.id === id)?.muted).toBe(false);
  });

  it("validates the mute request and the session", async () => {
    const { id } = await seed();
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/mute`, 400, "invalid_request", { muted: "yes" });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/mute`, 400, "invalid_request", "{not json");
    await expectApiError(daemon, "POST", "/v1/sessions/nope/mute", 404, "not_found", { muted: true });
  });

  it("patches the label, persists it and shows it in the list", async () => {
    const { id } = await seed();
    const label = (): unknown => daemon.services.sessions().find((session) => session.id === id)?.label;
    expect(label()).toEqual({ name: null, color: null, pinned: false });
    await expectApiOk(daemon, `/v1/sessions/${id}/label`, { name: " Release work ", color: "blue" });
    await expectApiOk(daemon, `/v1/sessions/${id}/label`, { pinned: true });
    expect(label()).toEqual({ name: "Release work", color: "blue", pinned: true });
    expect(JSON.parse(readFileSync(join(daemon.config.stateDir, "labels.json"), "utf8"))).toEqual({ labels: { [id]: { name: "Release work", color: "blue", pinned: true } } });
    await expectApiOk(daemon, `/v1/sessions/${id}/label`, { name: "", color: null, pinned: false });
    expect(label()).toEqual({ name: null, color: null, pinned: false });
  });

  it("validates the label request and the session", async () => {
    const { id } = await seed();
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/label`, 400, "invalid_request", { color: "red" });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/label`, 400, "invalid_request", { name: "x".repeat(81) });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/label`, 400, "invalid_request", { title: "nope" });
    await expectApiError(daemon, "POST", "/v1/sessions/nope/label", 404, "not_found", { pinned: true });
  });

  it("answers 500 with a generic body when a state file cannot be written", async () => {
    const { id } = await seed();
    mkdirSync(join(daemon.config.stateDir, "mutes.json"));
    const message = await expectApiError(daemon, "POST", `/v1/sessions/${id}/mute`, 500, "internal", { muted: true });
    expect(message).toBe("internal error");
  });

  it("registers a device and rejects a malformed one", async () => {
    const device = { apnsToken: "ab".repeat(32), environment: "sandbox", name: "iPhone", notifications: ["done"] };
    await expectApiOk(daemon, "/v1/devices", device);
    const stored = JSON.parse(readFileSync(join(daemon.config.stateDir, "devices.json"), "utf8")) as { devices: { apnsToken: string }[] };
    expect(stored.devices.map((entry) => entry.apnsToken)).toEqual([device.apnsToken]);
    await expectApiError(daemon, "POST", "/v1/devices", 400, "invalid_request", { ...device, apnsToken: "short" });
  });
});

describe("requests that do not exist", () => {
  it("answers 404 for permission and answer calls without a pending request, 400 for bad bodies", async () => {
    const { id } = await seed();
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/permission/r1`, 404, "not_found", { decision: "allow" });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/permission/r1`, 400, "invalid_request", { decision: "maybe" });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/answer/q1`, 404, "not_found", { option: "Tea" });
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/answer/q1`, 400, "invalid_request", {});
  });

  it("answers 404 for owned-session actions on sessions that are not known", async () => {
    for (const action of ["resume", "takeover", "fork"]) {
      await expectApiError(daemon, "POST", `/v1/sessions/nope/${action}`, 404, "not_found");
    }
    await expectApiError(daemon, "POST", "/v1/sessions/new", 400, "invalid_request", { cwd: "/tmp" });
  });
});

describe("message to a terminal session", () => {
  it("posts into the inbox socket and confirms delivery from the transcript", async () => {
    const inbox = await startInbox(true, null);
    inboxes.push(inbox);
    const { id, transcript } = await seed({ messagingSocketPath: inbox.socketPath }, PROMPTING);
    inbox.setTranscript(transcript);
    expect(daemon.services.sessions().find((session) => session.id === id)?.replyMode).toBe("composer");
    await expectApiOk(daemon, `/v1/sessions/${id}/message`, { text: "hello from the phone" });
    expect(inbox.received).toEqual(["hello from the phone"]);
  });

  it("answers queued, not an error, when a busy session has not shown the message yet", async () => {
    const inbox = await startInbox(false, null);
    inboxes.push(inbox);
    const { id } = await seed({ messagingSocketPath: inbox.socketPath, status: "busy" }, PROMPTING);
    expect(daemon.services.sessions().find((session) => session.id === id)?.status).toBe("working");
    const response = await daemon.call("POST", `/v1/sessions/${id}/message`, { text: "after the turn" });
    expect(response.status).toBe(200);
    expect(messageResultSchema.parse(response.json)).toEqual({ ok: true, queued: true });
    expect(inbox.received).toEqual(["after the turn"]);
  });

  it("reports an error when an idle session never shows the message in its transcript", async () => {
    const inbox = await startInbox(false, null);
    inboxes.push(inbox);
    const { id } = await seed({ messagingSocketPath: inbox.socketPath, status: "idle" }, PROMPTING);
    expect(daemon.services.sessions().find((session) => session.id === id)?.status).toBe("idle");
    const message = await expectApiError(daemon, "POST", `/v1/sessions/${id}/message`, 501, "unsupported", { text: "ignored message" });
    expect(message).toContain("holding it");
    expect(inbox.received).toEqual(["ignored message"]);
  });

  it("confirms delivery for a live session whose transcript appears only after the message", async () => {
    const inbox = await startInbox(true, null);
    inboxes.push(inbox);
    const sessionId = "abababab-abab-4bab-8bab-abababababab";
    daemon.home.addRegistry({ fixture: "busy", sessionId, overrides: { messagingSocketPath: inbox.socketPath } });
    await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
    const { path } = daemon.home.addTranscript({ fixture: PROMPTING, sessionId });
    inbox.setTranscript(path);
    await expectApiOk(daemon, `/v1/sessions/${sessionId}/message`, { text: "first words" });
  });

  it("tells the client to take over or resume when the session cannot take messages", async () => {
    const noInbox = await seed({ messagingSocketPath: null });
    expect(await expectApiError(daemon, "POST", `/v1/sessions/${noInbox.id}/message`, 409, "conflict", { text: "hi" })).toContain("take it over or resume");
    const ended = daemon.home.addTranscript({ fixture: "01b-minimal-session" }).sessionId;
    await waitUntil(() => daemon.services.sessions().some((session) => session.id === ended));
    await expectApiError(daemon, "POST", `/v1/sessions/${ended}/message`, 409, "conflict", { text: "hi" });
    await expectApiError(daemon, "POST", `/v1/sessions/${noInbox.id}/message`, 400, "invalid_request", { text: "" });
    await expectApiError(daemon, "POST", "/v1/sessions/nope/message", 404, "not_found", { text: "hi" });
  });

  it("reports an unreachable inbox socket", async () => {
    const { id } = await seed({ messagingSocketPath: join(daemon.config.stateDir, "missing.sock") }, PROMPTING);
    expect(await expectApiError(daemon, "POST", `/v1/sessions/${id}/message`, 501, "unsupported", { text: "hi" })).toContain("not reachable");
  });
});

describe("stop and kill", () => {
  it("sends Escape to the tmux pane of a terminal session", async () => {
    const name = `fdtest-${Math.random().toString(36).slice(2, 10)}`;
    const target = join(daemon.config.stateDir, "escape.bin");
    tmuxSessions.push(name);
    execFileSync(daemon.config.tmuxBinary, ["new-session", "-d", "-s", name, `stty raw -echo; head -c1 > ${target}`]);
    const { id } = await seed({ tmux: name });
    expect(daemon.services.sessions().find((session) => session.id === id)?.canStop).toBe(true);
    await expectStopSendsEscape(daemon, id, target);
  });

  it("cannot stop a session outside tmux, or one that does not run in the pane", async () => {
    const { id } = await seed();
    expect(await expectApiError(daemon, "POST", `/v1/sessions/${id}/stop`, 501, "unsupported")).toContain("not owned");
    await seed({ tmux: `fdtest-missing-${Math.random().toString(36).slice(2, 8)}` }).then(async ({ id: other }) => {
      expect(await expectApiError(daemon, "POST", `/v1/sessions/${other}/stop`, 501, "unsupported")).toContain("not reachable");
    });
    await expectApiError(daemon, "POST", "/v1/sessions/nope/stop", 404, "not_found");
  });

  it("kills the process of a terminal session; the session ends and a second kill conflicts", async () => {
    const { id, pid } = await seed();
    expect(await expectApiKilled(daemon, `/v1/sessions/${id}/kill`)).toBe("none");
    expect(isProcessAlive(pid)).toBe(false);
    await waitUntil(() => daemon.services.sessions().find((session) => session.id === id)?.status === "ended");
    await sleep(50);
    await expectApiError(daemon, "POST", `/v1/sessions/${id}/kill`, 409, "conflict");
    await expectApiError(daemon, "POST", "/v1/sessions/nope/kill", 404, "not_found");
  });
});
