import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCAL_NAME, PEER_NAME, runTool, linkedPairSuite } from "../../test/support/coordinator.js";
import { makeTempDir } from "../../test/support/env.js";
import { MAX_IMAGE_BYTES, imageHash } from "../service/imageStore.js";

const suite = linkedPairSuite();
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("coordinator picture")]);

function file(name: string, bytes: Uint8Array): string {
  const path = join(makeTempDir("fdimg-"), name);
  writeFileSync(path, bytes);
  return path;
}

const labelOf = (daemon: typeof suite.pair.local, id: string): string | null | undefined => daemon.services.sessions().find((session) => session.id === id)?.label.image;

describe("set_session_image and clear_session_image", () => {
  it("sets the image of a local session from a file path, and clears it", async () => {
    const id = suite.pair.localSessionId;
    const set = await runTool(suite.backend, "set_session_image", { machine: LOCAL_NAME, sessionId: id, path: file("a.png", png) });
    expect(set).toEqual({ text: `image set (${imageHash(png)})`, isError: false });
    expect(labelOf(suite.pair.local, id)).toBe(imageHash(png));
    expect(await runTool(suite.backend, "clear_session_image", { machine: LOCAL_NAME, sessionId: id })).toEqual({ text: "image cleared", isError: false });
    expect(labelOf(suite.pair.local, id)).toBeNull();
  });

  it("sets and clears the image of a session on a peer machine", async () => {
    const id = suite.pair.peerSessionId;
    await runTool(suite.backend, "set_session_image", { machine: PEER_NAME, sessionId: id, path: file("b.png", png) });
    expect(labelOf(suite.pair.peer, id)).toBe(imageHash(png));
    await runTool(suite.backend, "clear_session_image", { machine: PEER_NAME, sessionId: id });
    expect(labelOf(suite.pair.peer, id)).toBeNull();
  });

  it("rejects a file that is not a JPEG or PNG, a missing file, a relative path and a file over 2 MB", async () => {
    const args = { machine: LOCAL_NAME, sessionId: suite.pair.localSessionId };
    expect(await runTool(suite.backend, "set_session_image", { ...args, path: file("notes.png", Buffer.from("plain text")) })).toMatchObject({ isError: true, text: expect.stringContaining("not a JPEG or a PNG") as string });
    expect(await runTool(suite.backend, "set_session_image", { ...args, path: "/no/such/image.png" })).toMatchObject({ isError: true });
    expect(await runTool(suite.backend, "set_session_image", { ...args, path: "image.png" })).toMatchObject({ isError: true });
    const big = file("big.png", Buffer.concat([png, Buffer.alloc(MAX_IMAGE_BYTES)]));
    expect(await runTool(suite.backend, "set_session_image", { ...args, path: big })).toMatchObject({ isError: true, text: expect.stringContaining("sips -Z 512") as string });
    expect(labelOf(suite.pair.local, args.sessionId)).toBeNull();
  });
});
