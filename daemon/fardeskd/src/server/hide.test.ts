import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectApiError, expectApiOk } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { SELF_ADDRESS, createFakeTailscale } from "../../test/support/fakeTailscale.js";
import { hiddenSessionListSchema, machineSchema } from "../contract/schema.js";

let daemon: TestDaemon;

beforeEach(async () => {
  daemon = await startTestDaemon();
});

afterEach(async () => {
  await daemon.close();
});

const listedIds = (): string[] => daemon.services.sessions().map((session) => session.id);
const hiddenFile = (): unknown => JSON.parse(readFileSync(join(daemon.config.stateDir, "hidden-sessions.json"), "utf8"));
const hiddenList = async (): Promise<ReturnType<typeof hiddenSessionListSchema.parse>> =>
  hiddenSessionListSchema.parse((await daemon.call("GET", "/v1/sessions/hidden")).json);

async function seedStopped(): Promise<string> {
  const { sessionId } = daemon.home.addTranscript({ fixture: "01b-minimal-session" });
  await waitUntil(() => listedIds().includes(sessionId));
  expect(daemon.services.sessions().find((session) => session.id === sessionId)?.status).toBe("ended");
  return sessionId;
}

describe("hiding a stopped session", () => {
  it("leaves it out of the list, lists it as hidden, persists it, and brings it back on unhide", async () => {
    const id = await seedStopped();
    expect((await hiddenList()).sessions).toEqual([]);
    await expectApiOk(daemon, `/v1/sessions/${id}/hide`);
    expect(listedIds()).not.toContain(id);
    const shown = (await hiddenList()).sessions;
    expect(shown.map((session) => session.id)).toEqual([id]);
    expect(Object.keys(shown[0] ?? {}).sort()).toEqual(["cwd", "id", "title", "updatedAt"]);
    expect(shown[0]?.id).toBe(id);
    expect(hiddenFile()).toEqual({ hidden: [id] });
    expect(((await daemon.call("GET", "/v1/sessions")).json as { id: string }[]).map((session) => session.id)).not.toContain(id);
    await expectApiOk(daemon, `/v1/sessions/${id}/unhide`);
    expect(listedIds()).toContain(id);
    expect((await hiddenList()).sessions).toEqual([]);
    expect(hiddenFile()).toEqual({ hidden: [] });
  });

  it("hides a pinned stopped session too", async () => {
    const id = await seedStopped();
    await expectApiOk(daemon, `/v1/sessions/${id}/label`, { pinned: true });
    await expectApiOk(daemon, `/v1/sessions/${id}/hide`);
    expect(listedIds()).not.toContain(id);
  });

  it("is listed again when the session runs again, and is not hidden again when it stops", async () => {
    const id = await seedStopped();
    await expectApiOk(daemon, `/v1/sessions/${id}/hide`);
    const { pid } = daemon.home.addRegistry({ fixture: "busy", sessionId: id });
    await waitUntil(() => listedIds().includes(id));
    expect((await hiddenList()).sessions).toEqual([]);
    expect(hiddenFile()).toEqual({ hidden: [] });
    daemon.home.removeRegistry(pid);
    await waitUntil(() => daemon.services.sessions().find((session) => session.id === id)?.status === "ended");
    expect(listedIds()).toContain(id);
  });

  it("refuses a running session and an unknown one", async () => {
    const { sessionId } = daemon.home.addTranscript({ fixture: "01b-minimal-session" });
    daemon.home.addRegistry({ fixture: "busy", sessionId });
    await waitUntil(() => daemon.services.sessions().find((session) => session.id === sessionId)?.status === "working");
    await expectApiError(daemon, "POST", `/v1/sessions/${sessionId}/hide`, 409, "conflict");
    await expectApiError(daemon, "POST", "/v1/sessions/nope/hide", 404, "not_found");
    await expectApiError(daemon, "POST", "/v1/sessions/nope/unhide", 404, "not_found");
  });

  it("needs the bearer token like every other route", async () => {
    const id = await seedStopped();
    expect((await daemon.call("POST", `/v1/sessions/${id}/hide`, undefined, null)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/sessions/hidden", undefined, null)).status).toBe(401);
    expect(daemon.services.sessions().map((session) => session.id)).toContain(id);
  });
});

describe("the machine reports why it may be unreachable", () => {
  it("shows the Tailscale state read live and follows it", async () => {
    await daemon.close();
    const tailscale = createFakeTailscale(SELF_ADDRESS);
    daemon = await startTestDaemon({}, { tailscaleCommands: [tailscale.binary], tailscalePollMs: 50 });
    const state = (): string => daemon.services.machine().tailscale.state;
    await waitUntil(() => state() === "running");
    expect(machineSchema.parse((await daemon.call("GET", "/v1/machine")).json).tailscale).toEqual({ state: "running" });
    tailscale.setAddress(null);
    await waitUntil(() => state() === "stopped");
    expect(machineSchema.parse((await daemon.call("GET", "/v1/machine")).json).tailscale).toEqual({ state: "stopped" });
  });

  it("says not-installed when there is no tailscale command", async () => {
    await daemon.close();
    daemon = await startTestDaemon({}, { tailscaleCommands: ["/nonexistent/fardesk-test-tailscale"], tailscalePollMs: 50 });
    await waitUntil(() => daemon.services.machine().tailscale.state === "not-installed");
  });
});
