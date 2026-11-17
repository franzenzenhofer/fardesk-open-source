import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestDaemon, TEST_TOKEN } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { makeTempDir } from "../../test/support/env.js";
import { startInbox } from "../../test/support/inboxServer.js";
import type { InboxServer } from "../../test/support/inboxServer.js";
import { seedSession } from "../../test/support/terminalRig.js";
import { createAttachmentStore, MAX_ATTACHMENT_BYTES } from "../attachments/store.js";
import { attachmentResultSchema } from "../contract/schema.js";
import { readBoundedBody } from "./boundedBody.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const MB = 1_000_000;
let daemon: TestDaemon;
let inbox: InboxServer;

beforeEach(async () => {
  [daemon, inbox] = await Promise.all([startTestDaemon(), startInbox(true, null)]);
});

afterEach(async () => {
  await Promise.all([daemon.close(), inbox.close()]);
});

async function post(path: string, body: Uint8Array | ReadableStream<Uint8Array>, headers: Record<string, string>): Promise<{ status: number; message: string }> {
  const response = await fetch(`${daemon.url}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "image/png", ...headers },
    body,
    duplex: "half",
  });
  const json = (await response.json()) as { error?: { message: string } };
  return { status: response.status, message: json.error?.message ?? "" };
}

function chunkedStream(chunks: number): { stream: ReadableStream<Uint8Array>; pulled: () => number } {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller): void {
      pulled += 1;
      if (pulled > chunks) controller.close();
      else controller.enqueue(new Uint8Array(MB));
    },
  });
  return { stream, pulled: () => pulled };
}

describe("upload size limits", () => {
  it("refuses a chunked upload without content-length", async () => {
    const { id } = await seedSession(daemon, inbox, { cwd: makeTempDir("fdcwd-") });
    const { stream } = chunkedStream(21);
    const result = await post(`/v1/sessions/${id}/attachments`, stream, {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("content-length");
  });

  it("refuses 21 MB declared up front, before reading the body", async () => {
    const { id } = await seedSession(daemon, inbox, { cwd: makeTempDir("fdcwd-") });
    const result = await post(`/v1/sessions/${id}/attachments`, Buffer.alloc(21 * MB), {});
    expect(result.status).toBe(400);
    expect(result.message).toContain("larger than 20 MB");
  });

  it("cuts a stream off at the cap without pulling the rest, even when it lies about its length", async () => {
    const { stream, pulled } = chunkedStream(500);
    const request = new Request("http://daemon.invalid/upload", {
      method: "POST",
      headers: { "content-length": String(MAX_ATTACHMENT_BYTES) },
      body: stream,
      duplex: "half",
    });
    await expect(readBoundedBody(request, MAX_ATTACHMENT_BYTES)).rejects.toMatchObject({ code: "invalid_request" });
    expect(pulled()).toBeLessThan(MAX_ATTACHMENT_BYTES / MB + 5);
  });

  it("refuses a body that does not match its declared length", async () => {
    const short = new Request("http://daemon.invalid/upload", { method: "POST", headers: { "content-length": "10" }, body: new Uint8Array(4) });
    await expect(readBoundedBody(short, MAX_ATTACHMENT_BYTES)).rejects.toThrow("shorter");
    const long = new Request("http://daemon.invalid/upload", { method: "POST", headers: { "content-length": "4" }, body: new Uint8Array(20) });
    await expect(readBoundedBody(long, MAX_ATTACHMENT_BYTES)).rejects.toThrow("longer");
  });

  it("takes an upload of exactly its declared length", async () => {
    const { id } = await seedSession(daemon, inbox, { cwd: makeTempDir("fdcwd-") });
    expect((await post(`/v1/sessions/${id}/attachments`, PNG, {})).status).toBe(200);
  });
});

describe("stored attachments", () => {
  async function store(cwd: string): Promise<{ id: string; path: string }> {
    const { id } = await seedSession(daemon, inbox, { cwd });
    const response = await fetch(`${daemon.url}/v1/sessions/${id}/attachments`, { method: "POST", headers: { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "image/png" }, body: PNG });
    return { id, path: attachmentResultSchema.parse(await response.json()).path };
  }

  it("serves a regular file", async () => {
    const { id, path } = await store(makeTempDir("fdcwd-"));
    const response = daemon.services.readAttachment(id, path);
    expect(response.bytes.byteLength).toBe(PNG.length);
  });

  it("answers 404 when a symlink has taken the place of the stored file", async () => {
    const { id, path } = await store(makeTempDir("fdcwd-"));
    const secret = join(makeTempDir("fdsecret-"), "secret.txt");
    writeFileSync(secret, "do not serve me");
    rmSync(path);
    symlinkSync(secret, path);
    const response = await fetch(`${daemon.url}/v1/sessions/${id}/attachment?path=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("do not serve me");
  });

  it("writes a .gitignore with * into a fresh .fardesk folder on the first upload and keeps one that exists", async () => {
    const cwd = makeTempDir("fdcwd-");
    expect(existsSync(join(cwd, ".fardesk"))).toBe(false);
    const { path } = await store(cwd);
    expect(path.startsWith(join(cwd, ".fardesk", "attachments"))).toBe(true);
    expect(readFileSync(join(cwd, ".fardesk", ".gitignore"), "utf8")).toBe("*\n");
    writeFileSync(join(cwd, ".fardesk", ".gitignore"), "custom\n");
    await store(cwd);
    expect(readFileSync(join(cwd, ".fardesk", ".gitignore"), "utf8")).toBe("custom\n");
  });
});

describe("per-session quota", () => {
  it("refuses an upload that would take the session over its quota, and counts per session", () => {
    const attachments = createAttachmentStore({ stateDir: makeTempDir("fd-quota-"), sessionQuotaBytes: 100 });
    const cwd = makeTempDir("fdcwd-");
    const upload = (sessionId: string, size: number): ReturnType<typeof attachments.save> =>
      attachments.save({ sessionId, cwd, mediaType: "image/png", filename: null, bytes: new Uint8Array(size) });
    upload("s1", 60);
    expect(() => upload("s1", 41)).toThrow("the limit is");
    expect(() => upload("s2", 100)).not.toThrow();
    expect(() => upload("s1", 40)).not.toThrow();
  });
});
