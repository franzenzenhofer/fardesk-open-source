import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { writePlainWrapper, writeWrapper } from "../../test/support/terminals.js";
import { postToInbox } from "../foreign/inbox.js";
import { listAllPanes, sendText } from "../foreign/tmux.js";
import { assertSandboxPath, assertSandboxTmux, endWithParent, sandboxAllowsSocket, SANDBOX_ENV } from "./sandbox.js";

describe("test sandbox guard (FARDESK_TEST_SANDBOX is set by vitest.config.ts)", () => {
  it("is active in the test run", () => {
    expect(process.env[SANDBOX_ENV]).toBeTruthy();
  });

  it("refuses paths outside the temp dir and accepts the ones inside", () => {
    expect(() => { assertSandboxPath("inbox socket", "/tmp/cc-socks/25870.sock"); }).toThrow("outside the test sandbox");
    expect(() => { assertSandboxPath("inbox socket", join(makeTempDir("fdg-"), "a.sock")); }).not.toThrow();
  });

  it("refuses a real session inbox before connecting to it", async () => {
    await expect(postToInbox({ socketPath: "/tmp/cc-socks/25870.sock", text: "must never arrive", from: "fardesk" })).rejects.toThrow("outside the test sandbox");
  });

  it("allows tmux input only to private fardesk-test servers", () => {
    expect(() => { assertSandboxTmux("tmux", null); }).toThrow("outside the test sandbox");
    expect(() => { assertSandboxTmux(writePlainWrapper(), null); }).toThrow("not a fardesk-test one");
    expect(() => { assertSandboxTmux(writePlainWrapper(), "/tmp/tmux-501/default"); }).toThrow("not a fardesk-test one");
    expect(() => { assertSandboxTmux(writeWrapper().binary, null); }).not.toThrow();
    expect(() => { assertSandboxTmux(writePlainWrapper(), "/tmp/tmux-501/fardesk-test-abc"); }).not.toThrow();
  });

  it("looks only at fardesk-test tmux sockets", () => {
    expect(sandboxAllowsSocket("/tmp/tmux-501/default")).toBe(false);
    expect(sandboxAllowsSocket("/tmp/tmux-501/fardesk-test-x1")).toBe(true);
  });

  it("stops typing into a pane of a real tmux server before running any tmux command", async () => {
    const binary = writePlainWrapper();
    const run = (): Promise<string> => Promise.reject(new Error("must not run"));
    await expect(sendText({ tmuxBinary: "tmux", pane: "%1", socket: "/tmp/tmux-501/default", run, runWithInput: run, text: "x" })).rejects.toThrow("outside the test sandbox");
    await expect(sendText({ tmuxBinary: binary, pane: "%1", socket: "/tmp/tmux-501/default", run, runWithInput: run, text: "x" })).rejects.toThrow("not a fardesk-test one");
  });

  // A kill with closeTab walks the session's ancestors to a pane. The test runner itself may run in a pane of the
  // real default server (an agent in tmux): listing that server let a test kill the runner's own pane and tmux.
  it("never lists the panes of the real default tmux server, only a private wrapper's server", async () => {
    const asked: string[][] = [];
    const run = (_binary: string, args: string[]): Promise<string> => {
      asked.push(args);
      return Promise.resolve("");
    };
    for (const tmuxBinary of ["tmux", writePlainWrapper()]) {
      asked.length = 0;
      await listAllPanes({ tmuxBinary, run });
      expect(asked.filter((args) => args[0] !== "-S")).toEqual([]);
    }
    asked.length = 0;
    await listAllPanes({ tmuxBinary: writeWrapper().binary, run });
    expect(asked.filter((args) => args[0] !== "-S")).toEqual([["list-panes", "-a", "-F", "#{pane_pid} #{pane_id}"]]);
  });
});

describe("endWithParent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ends a sandboxed daemon once its parent is gone, and only then", async () => {
    let parent = 4242;
    let gone = 0;
    const stop = endWithParent(() => parent, () => { gone += 1; }, 10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gone).toBe(0);
    parent = 1;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(gone).toBe(1);
    stop();
  });

  it("watches nothing outside the sandbox", async () => {
    vi.stubEnv(SANDBOX_ENV, "");
    let gone = 0;
    let reads = 0;
    const stop = endWithParent(() => { reads += 1; return reads; }, () => { gone += 1; }, 10);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect([gone, reads]).toEqual([0, 0]);
    stop();
  });
});
