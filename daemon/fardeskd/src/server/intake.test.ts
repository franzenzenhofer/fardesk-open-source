// Telemetry (T7) and attachments (T9) over the real HTTP API.
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { startTestDaemon, TEST_TOKEN } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir } from "../../test/support/env.js";
import { seedSession as seed } from "../../test/support/terminalRig.js";
import { startInbox } from "../../test/support/inboxServer.js";
import type { InboxServer } from "../../test/support/inboxServer.js";
import { attachmentResultSchema, notificationStateSchema, telemetryListSchema, telemetryResultSchema } from "../contract/schema.js";
import type { TelemetryReport } from "../contract/schema.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
let daemon: TestDaemon;
let inbox: InboxServer;

beforeEach(async () => {
  daemon = await startTestDaemon();
  inbox = await startInbox(true, null);
});

afterEach(async () => {
  await daemon.close();
  await inbox.close();
});

function report(n: number): TelemetryReport {
  return {
    id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    at: `2026-11-15T11:00:${String(n).padStart(2, "0")}.000Z`,
    message: `boom ${n}`,
    code: "URLError -1001",
    area: "stream",
    machine: "test-mac",
    appVersion: "1.2.0",
    build: "8",
    platform: "iOS 26.1",
  };
}

describe("telemetry", () => {
  it("stores a batch, dedups by id and lists the newest first", async () => {
    const first = await daemon.call("POST", "/v1/telemetry", { reports: [report(1), report(2)] });
    expect(telemetryResultSchema.parse(first.json)).toEqual({ accepted: 2, duplicates: 0 });
    const again = await daemon.call("POST", "/v1/telemetry", { reports: [report(2), report(3)] });
    expect(telemetryResultSchema.parse(again.json)).toEqual({ accepted: 1, duplicates: 1 });
    const listed = telemetryListSchema.parse((await daemon.call("GET", "/v1/telemetry")).json);
    expect(listed.reports.map((r) => r.message)).toEqual(["boom 3", "boom 2", "boom 1"]);
    const recent = telemetryListSchema.parse((await daemon.call("GET", "/v1/telemetry?since=2026-11-15T11:00:02.000Z&limit=1")).json);
    expect(recent.reports.map((r) => r.message)).toEqual(["boom 3"]);
    expect(readFileSync(join(daemon.config.stateDir, "telemetry.jsonl"), "utf8").trim().split("\n")).toHaveLength(3);
  });

  it("accepts events with durationMs and filters by kind (absent kind counts as error)", async () => {
    const event = { ...report(5), kind: "event" as const, durationMs: 420, message: "session opened" };
    await daemon.call("POST", "/v1/telemetry", { reports: [report(4), event] });
    const names = async (query: string): Promise<string[]> => telemetryListSchema.parse((await daemon.call("GET", `/v1/telemetry${query}`)).json).reports.map((r) => r.message);
    expect(await names("")).toEqual(["session opened", "boom 4"]);
    expect(await names("?kind=event")).toEqual(["session opened"]);
    expect(await names("?kind=error")).toEqual(["boom 4"]);
    await expectApiError(daemon, "GET", "/v1/telemetry?kind=other", 400, "invalid_request");
  });

  it("pauses notifications, reports the state, persists it and resumes with 0", async () => {
    const state = async (): Promise<string | null> => notificationStateSchema.parse((await daemon.call("GET", "/v1/notifications")).json).pausedUntil;
    expect(await state()).toBeNull();
    const before = Date.now();
    const paused = notificationStateSchema.parse((await daemon.call("POST", "/v1/notifications/pause", { minutes: 60 })).json);
    expect(Date.parse(paused.pausedUntil ?? "")).toBeGreaterThanOrEqual(before + 3_600_000);
    expect(await state()).toBe(paused.pausedUntil);
    expect(readFileSync(join(daemon.config.stateDir, "notification-pause.json"), "utf8")).toContain(paused.pausedUntil ?? "never");
    expect(notificationStateSchema.parse((await daemon.call("POST", "/v1/notifications/pause", { minutes: 0 })).json).pausedUntil).toBeNull();
    expect(await state()).toBeNull();
    await expectApiError(daemon, "POST", "/v1/notifications/pause", 400, "invalid_request", { minutes: -1 });
    expect((await daemon.call("GET", "/v1/notifications", undefined, null)).status).toBe(401);
  });

  it("needs the token and a valid batch", async () => {
    expect((await daemon.call("POST", "/v1/telemetry", { reports: [report(1)] }, null)).status).toBe(401);
    expect((await daemon.call("GET", "/v1/telemetry", undefined, null)).status).toBe(401);
    await expectApiError(daemon, "POST", "/v1/telemetry", 400, "invalid_request", { reports: [] });
    await expectApiError(daemon, "POST", "/v1/telemetry", 400, "invalid_request", { reports: [{ ...report(1), id: "not-a-uuid" }] });
    await expectApiError(daemon, "GET", "/v1/telemetry?limit=0", 400, "invalid_request");
  });
});

async function upload(path: string, body: Uint8Array, headers: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const response = await daemon.fetch(path, { method: "POST", headers: { authorization: `Bearer ${TEST_TOKEN}`, ...headers }, body });
  return { status: response.status, json: await response.json() };
}

const seedSession = async (cwd: string): Promise<{ id: string; transcript: string }> => seed(daemon, inbox, { cwd });

describe("attachments", () => {
  it("stores the upload under the session cwd in .fardesk/attachments with a safe name", async () => {
    const cwd = makeTempDir("fdcwd-");
    const { id } = await seedSession(cwd);
    const response = await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "image/png", "x-fardesk-filename": "../../My Screen Shot.png" });
    expect(response.status).toBe(200);
    const result = attachmentResultSchema.parse(response.json);
    expect(result).toMatchObject({ mediaType: "image/png", bytes: PNG.length });
    expect(result.path.startsWith(join(cwd, ".fardesk", "attachments"))).toBe(true);
    expect(result.path).toMatch(/\/\d{8}T\d{9}Z-My_Screen_Shot\.png$/);
    expect(readFileSync(result.path)).toEqual(PNG);
  });

  it("accepts every listed media type and names the file with its extension", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const names: Record<string, string> = { "image/jpeg": ".jpg", "image/heic": ".heic", "audio/m4a": ".m4a", "audio/mp4": ".m4a", "audio/wav": ".wav" };
    for (const [mediaType, extension] of Object.entries(names)) {
      const result = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": `${mediaType}; charset=binary` })).json);
      expect(result.path.endsWith(`-attachment${extension}`)).toBe(true);
      expect(result.mediaType).toBe(mediaType);
    }
  });

  it("uses the daemon data dir when the session folder is not writable", async () => {
    const cwd = makeTempDir("fdcwd-");
    mkdirSync(join(cwd, ".fardesk"));
    chmodSync(join(cwd, ".fardesk"), 0o500);
    const { id } = await seedSession(cwd);
    const result = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "image/png" })).json);
    expect(result.path.startsWith(join(daemon.config.stateDir, "attachments", id))).toBe(true);
    expect(existsSync(result.path)).toBe(true);
    chmodSync(join(cwd, ".fardesk"), 0o700);
  });

  it("stores a pdf as a file and keeps its extension", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const bytes = new TextEncoder().encode("%PDF-1.4 test");
    const response = await upload(`/v1/sessions/${id}/attachments`, bytes, { "content-type": "application/pdf", "x-fardesk-filename": "Q3 Report.pdf" });
    expect(response.status).toBe(200);
    const result = attachmentResultSchema.parse(response.json);
    expect(result).toMatchObject({ mediaType: "application/pdf", bytes: bytes.length });
    expect(result.path).toMatch(/-Q3_Report\.pdf$/);
    expect(readFileSync(result.path)).toEqual(Buffer.from(bytes));
  });

  it("stores an unknown type under its own filename extension, and without a filename as plain attachment", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const path = `/v1/sessions/${id}/attachments`;
    const named = attachmentResultSchema.parse((await upload(path, PNG, { "content-type": "application/x-weird", "x-fardesk-filename": "data.xyz" })).json);
    expect(named.path).toMatch(/-data\.xyz$/);
    const unnamed = attachmentResultSchema.parse((await upload(path, PNG, { "content-type": "application/octet-stream" })).json);
    expect(unnamed.path).toMatch(/-attachment$/);
  });

  it("tells Claude about a file with the word file", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const file = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "application/pdf", "x-fardesk-filename": "a.pdf" })).json);
    await daemon.call("POST", `/v1/sessions/${id}/message`, { text: "read it", attachments: [file.attachmentId] });
    expect(inbox.received).toEqual([`read it\nAttached file: ${file.path}`]);
  });

  it("rejects empty and too large uploads, and unknown sessions", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const path = `/v1/sessions/${id}/attachments`;
    expect((await upload(path, new Uint8Array(0), { "content-type": "application/pdf" })).status).toBe(400);
    expect((await upload(path, new Uint8Array(0), { "content-type": "image/png" })).status).toBe(400);
    const tooPdf = await upload(path, new Uint8Array(20_000_001), { "content-type": "application/pdf" });
    expect(tooPdf.status).toBe(400);
    const tooBig = await upload(path, new Uint8Array(20_000_001), { "content-type": "image/png" });
    expect(tooBig.status).toBe(400);
    expect(JSON.stringify(tooBig.json)).toContain("20 MB");
    expect((await upload("/v1/sessions/nope/attachments", PNG, { "content-type": "image/png" })).status).toBe(404);
  });

  it("appends the attachment paths to the delivered reply, one line per file", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const image = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "image/png" })).json);
    const audio = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "audio/m4a" })).json);
    const response = await daemon.call("POST", `/v1/sessions/${id}/message`, { text: "look at this", attachments: [image.attachmentId, audio.attachmentId] });
    expect(response.status).toBe(200);
    expect(inbox.received).toEqual([`look at this\nAttached image: ${image.path}\nAttached audio: ${audio.path}`]);
  });

  it("only accepts attachment ids of the session they were uploaded to", async () => {
    const first = await seedSession(makeTempDir("fdcwd-"));
    const second = await seedSession(makeTempDir("fdcwd-"));
    const { attachmentId } = attachmentResultSchema.parse((await upload(`/v1/sessions/${first.id}/attachments`, PNG, { "content-type": "image/png" })).json);
    const message = await expectApiError(daemon, "POST", `/v1/sessions/${second.id}/message`, 404, "not_found", { text: "x", attachments: [attachmentId] });
    expect(message).toContain("was not uploaded to session");
    await expectApiError(daemon, "POST", `/v1/sessions/${first.id}/message`, 404, "not_found", { text: "x", attachments: ["unknown"] });
    expect(inbox.received).toEqual([]);
  });

  it("serves a stored attachment by its path with its media type, only inside its own session", async () => {
    const first = await seedSession(makeTempDir("fdcwd-"));
    const second = await seedSession(makeTempDir("fdcwd-"));
    const { path } = attachmentResultSchema.parse((await upload(`/v1/sessions/${first.id}/attachments`, PNG, { "content-type": "image/png" })).json);
    const fetched = await daemon.fetch(`/v1/sessions/${first.id}/attachment?path=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await fetched.arrayBuffer())).toEqual(PNG);
    await expectApiError(daemon, "GET", `/v1/sessions/${second.id}/attachment?path=${encodeURIComponent(path)}`, 404, "not_found");
    await expectApiError(daemon, "GET", `/v1/sessions/${first.id}/attachment?path=${encodeURIComponent("/etc/hosts")}`, 404, "not_found");
    await expectApiError(daemon, "GET", `/v1/sessions/nope/attachment?path=${encodeURIComponent(path)}`, 404, "not_found");
    await expectApiError(daemon, "GET", `/v1/sessions/${first.id}/attachment`, 400, "invalid_request");
    expect((await daemon.call("GET", `/v1/sessions/${first.id}/attachment?path=${encodeURIComponent(path)}`, undefined, null)).status).toBe(401);
  });

  it("persists the attachment index in the data dir so ids survive a restart", async () => {
    const { id } = await seedSession(makeTempDir("fdcwd-"));
    const { attachmentId, path } = attachmentResultSchema.parse((await upload(`/v1/sessions/${id}/attachments`, PNG, { "content-type": "image/png" })).json);
    const index = JSON.parse(readFileSync(join(daemon.config.stateDir, "attachments-index.json"), "utf8")) as { attachments: Record<string, { sessionId: string; path: string }> };
    expect(index.attachments[attachmentId]).toMatchObject({ sessionId: id, path });
  });
});
