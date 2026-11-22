// `fardeskd pair --show` against a real daemon: the code goes to a private PNG that the viewer command is asked to open,
// stdout and stderr never carry the link, and the folder is gone once the window ends. The viewer command is a recorder.
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PAIR_MAX_WRONG, WRONG_PAIR_CODE as WRONG, captureIo, runPairCli, runWithoutProcesses, startTestDaemon, waitUntil, writeConfigFile } from "../../test/support/pairCli.js";
import type { CapturedIo, TestDaemon } from "../../test/support/pairCli.js";
import type { RunCommand } from "../config/bind.js";
import type { CliDeps } from "./types.js";

const PNG_SIGNATURE = "89504e470d0a1a0a";
const IHDR_WIDTH_OFFSET = 16;
const OPENED_LINE = "the pairing code is open on this computer's screen; scan it with the Fardesk app (2 minutes)";
let daemon: TestDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

type Viewer = { run: RunCommand; calls: { command: string; path: string; fileMode: number; dirMode: number; bytes: Buffer }[] };

function recordingViewer(fail = false): Viewer {
  const calls: Viewer["calls"] = [];
  const run: RunCommand = async (command, args) => {
    if (command !== "open" && command !== "xdg-open") return runWithoutProcesses(command, args);
    const path = args[0] ?? "";
    calls.push({ command, path, fileMode: statSync(path).mode & 0o777, dirMode: statSync(dirname(path)).mode & 0o777, bytes: readFileSync(path) });
    if (fail) throw new Error("no viewer answered");
    return "";
  };
  return { run, calls };
}

function startShow(viewer: Viewer, deps: Partial<CliDeps>, env: NodeJS.ProcessEnv = {}): { io: CapturedIo; done: Promise<number> } {
  const io = captureIo(env);
  const config = writeConfigFile((daemon as TestDaemon).config);
  const done = runPairCli(["--show", "--config", config], io, { run: viewer.run, platform: "darwin", ...deps });
  return { io, done };
}

function expectNoCode(io: CapturedIo): void {
  const text = [...io.out, ...io.err].join("\n");
  expect(text).not.toContain("fardesk://");
  expect(text).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  expect(text).not.toContain("█");
}

describe("fardeskd pair --show", () => {
  it("opens a private PNG, prints no code, and removes the folder when stopped", async () => {
    daemon = await startTestDaemon();
    const viewer = recordingViewer();
    const { io, done } = startShow(viewer, {});
    await waitUntil(() => io.out.includes(OPENED_LINE));
    const [opened] = viewer.calls;
    expect(opened?.command).toBe("open");
    expect(opened?.fileMode).toBe(0o600);
    expect(opened?.dirMode).toBe(0o700);
    expect(opened?.bytes.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
    expect(opened?.bytes.readUInt32BE(IHDR_WIDTH_OFFSET)).toBeGreaterThanOrEqual(600);
    expect(existsSync(opened?.path ?? "")).toBe(true);
    io.stop();
    expect(await done).toBe(1);
    expect(existsSync(dirname(opened?.path ?? ""))).toBe(false);
    expectNoCode(io);
  });

  it("removes the folder when five wrong codes lock the window", async () => {
    daemon = await startTestDaemon({ auth: { maxFailures: 50, windowSeconds: 60 } });
    const viewer = recordingViewer();
    const { io, done } = startShow(viewer, {});
    await waitUntil(() => io.out.includes(OPENED_LINE));
    for (let attempt = 0; attempt < PAIR_MAX_WRONG; attempt += 1) {
      expect((await daemon.call("POST", "/v1/auth/pair", { code: WRONG, deviceName: "x" }, null)).status).toBeGreaterThanOrEqual(401);
    }
    expect(await done).toBe(1);
    expect(existsSync(dirname(viewer.calls[0]?.path ?? ""))).toBe(false);
    expectNoCode(io);
  });

  it("fails loud and leaves nothing behind when the viewer cannot open the image", async () => {
    daemon = await startTestDaemon();
    const viewer = recordingViewer(true);
    const { io, done } = startShow(viewer, {});
    expect(await done).toBe(1);
    expect(io.err.join("\n")).toContain("no screen here to show the code: run `fardeskd pair` in a terminal you are looking at");
    expect(existsSync(dirname(viewer.calls[0]?.path ?? ""))).toBe(false);
    expectNoCode(io);
  });

  it("refuses on headless linux before it opens a window", async () => {
    daemon = await startTestDaemon();
    const viewer = recordingViewer();
    const { io, done } = startShow(viewer, { platform: "linux" });
    expect(await done).toBe(1);
    expect(io.err.join("\n")).toContain("no screen here to show the code: run `fardeskd pair` in a terminal you are looking at");
    expect(viewer.calls).toHaveLength(0);
    expect((await daemon.call("POST", "/v1/auth/pair", { code: WRONG, deviceName: "x" }, null)).status).toBe(401);
  });

  it("uses xdg-open on linux with a display", async () => {
    daemon = await startTestDaemon();
    const viewer = recordingViewer();
    const { io, done } = startShow(viewer, { platform: "linux" }, { DISPLAY: ":0" });
    await waitUntil(() => io.out.includes(OPENED_LINE));
    expect(viewer.calls[0]?.command).toBe("xdg-open");
    io.stop();
    expect(await done).toBe(1);
  });
});
