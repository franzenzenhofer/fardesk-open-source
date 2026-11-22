import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { errorResponseSchema, imageResultSchema } from "../contract/schema.js";
import { MAX_IMAGE_BYTES, imageHash } from "../service/imageStore.js";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("jpeg picture bytes")]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("png picture bytes")]);
let daemon: TestDaemon;

beforeEach(async () => {
  daemon = await startTestDaemon();
});

afterEach(async () => {
  await daemon.close();
});

const imageDir = (): string => join(daemon.config.stateDir, "session-images");
const upload = async (id: string, type: string, body: Uint8Array): Promise<Response> =>
  daemon.fetch(`/v1/sessions/${id}/image`, { method: "POST", headers: { authorization: `Bearer ${TEST_TOKEN}`, "content-type": type }, body });
const download = async (id: string): Promise<Response> => daemon.fetch(`/v1/sessions/${id}/image`, { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
const labelImage = (id: string): string | null | undefined => daemon.services.sessions().find((session) => session.id === id)?.label.image;

async function seed(): Promise<string> {
  const { sessionId } = daemon.home.addTranscript({ fixture: "01b-minimal-session" });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  return sessionId;
}

describe("chat image routes", () => {
  it("stores a JPEG, shows its hash in the label and serves the same bytes with caching headers", async () => {
    const id = await seed();
    const response = await upload(id, "image/jpeg", JPEG);
    expect(response.status).toBe(200);
    const result = imageResultSchema.parse(await response.json());
    expect(result.image).toBe(imageHash(JPEG));
    expect(labelImage(id)).toBe(result.image);
    const served = await download(id);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(served.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(JPEG);
  });

  it("replaces a JPEG with a PNG and removes the old file", async () => {
    const id = await seed();
    await upload(id, "image/jpeg", JPEG);
    expect(readdirSync(imageDir())).toEqual([`${id}.jpg`]);
    expect((await upload(id, "image/png", PNG)).status).toBe(200);
    expect(readdirSync(imageDir())).toEqual([`${id}.png`]);
    expect(labelImage(id)).toBe(imageHash(PNG));
    const served = await download(id);
    expect(served.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await served.arrayBuffer())).toEqual(PNG);
  });

  it("refuses wrong bytes, a wrong type, an empty body and an upload over 2 MB, and keeps the old image", async () => {
    const id = await seed();
    await upload(id, "image/jpeg", JPEG);
    const refused = [
      await upload(id, "image/png", JPEG),
      await upload(id, "image/gif", JPEG),
      await upload(id, "image/jpeg", Buffer.alloc(0)),
      await upload(id, "image/jpeg", Buffer.concat([JPEG, Buffer.alloc(MAX_IMAGE_BYTES)])),
    ];
    for (const response of refused) {
      expect(response.status).toBe(400);
      expect(errorResponseSchema.parse(await response.json()).error.code).toBe("invalid_request");
    }
    expect(labelImage(id)).toBe(imageHash(JPEG));
  });

  it("clears the image: label null, file gone, GET answers 404", async () => {
    const id = await seed();
    await upload(id, "image/png", PNG);
    expect((await daemon.call("POST", `/v1/sessions/${id}/image/clear`)).json).toEqual({ ok: true });
    expect(labelImage(id)).toBeNull();
    expect(existsSync(join(imageDir(), `${id}.png`))).toBe(false);
    const missing = await download(id);
    expect(missing.status).toBe(404);
    expect(errorResponseSchema.parse(await missing.json()).error.code).toBe("not_found");
  });

  it("answers 404 for an unknown session and keeps the image when the name changes", async () => {
    const id = await seed();
    expect((await upload("nope", "image/png", PNG)).status).toBe(404);
    await upload(id, "image/png", PNG);
    await daemon.call("POST", `/v1/sessions/${id}/label`, { name: "Named" });
    expect(labelImage(id)).toBe(imageHash(PNG));
  });
});
