import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { writePlainWrapper, writeWrapper } from "../../test/support/terminals.js";
import { postToInbox } from "../foreign/inbox.js";
import { sendText } from "../foreign/tmux.js";
import { assertSandboxPath, assertSandboxTmux, sandboxAllowsSocket, SANDBOX_ENV } from "./sandbox.js";

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
});
