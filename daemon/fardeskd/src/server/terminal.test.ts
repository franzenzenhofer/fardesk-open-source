import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { sleep, waitUntil } from "../../test/support/env.js";
import { appendUserLine, useRig } from "../../test/support/terminalRig.js";
import type { Seeded } from "../../test/support/terminalRig.js";
import { killResultSchema } from "../contract/schema.js";
import { isProcessAlive } from "../sessions/processes.js";

const rig = useRig();

const seed = async (pid: number, overrides: Record<string, unknown> = {}): Promise<Seeded> => rig.seed(pid, overrides);

async function kill(id: string, body?: unknown): Promise<unknown> {
  const response = await rig.daemon.call("POST", `/v1/sessions/${id}/kill`, body);
  expect(response.status).toBe(200);
  return killResultSchema.parse(response.json);
}

describe("reply into a tmux pane", () => {
  const collector = (file: string): string => `sh -c 'while IFS= read -r line; do printf "%s\\n" "$line" >> ${file}; done; true'`;

  it("types a one-line reply with send-keys instead of using the inbox", async () => {
    const file = join(rig.daemon.config.stateDir, "typed.txt");
    const { panePid } = rig.sandbox.start(collector(file));
    const { id, transcript } = await seed(panePid);
    const delivery = rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text: "-x short reply" });
    await waitUntil(() => readFileSync(file, { encoding: "utf8", flag: "a+" }).includes("-x short reply"));
    appendUserLine(transcript, "-x short reply");
    expect((await delivery).status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("-x short reply\n");
    expect(rig.inbox.received).toEqual([]);
  });

  it("pastes a multi-line reply as one block, then presses Enter", async () => {
    const file = join(rig.daemon.config.stateDir, "pasted.txt");
    const { panePid } = rig.sandbox.start(collector(file));
    const { id, transcript } = await seed(panePid);
    const text = "first line\nsecond line";
    const delivery = rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text });
    await waitUntil(() => readFileSync(file, { encoding: "utf8", flag: "a+" }).includes("second line"));
    appendUserLine(transcript, text);
    expect((await delivery).status).toBe(200);
    expect(readFileSync(file, "utf8")).toBe("first line\nsecond line\n");
  });

  it("falls back to the inbox for a process outside tmux", async () => {
    const pid = rig.daemon.home.spawnLive();
    const { id } = await seed(pid, { status: "busy" });
    const response = await rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text: "plain terminal" });
    expect(response.status).toBe(200);
    expect(rig.inbox.received).toEqual(["plain terminal"]);
  });

  it("refuses to type into a pane that waits at a permission dialog", async () => {
    const { panePid } = rig.sandbox.start(collector(join(rig.daemon.config.stateDir, "never.txt")));
    const { id } = await seed(panePid, { status: "waiting", waitingFor: "tool approval" });
    const message = await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/message`, 409, "conflict", { text: "1" });
    expect(message).toContain("has a question open at the computer");
  });
});

describe("kill with closeTab in tmux", () => {
  it("kills claude and its pane, and reports pane", async () => {
    const { pane, panePid } = rig.sandbox.start("sh -c 'sleep 300; exec sleep 300'");
    const claudePid = await rig.sandbox.childOf(panePid);
    const { id } = await seed(claudePid);
    expect(await kill(id, { closeTab: true })).toEqual({ ok: true, closed: "pane" });
    expect(isProcessAlive(claudePid)).toBe(false);
    await waitUntil(() => !rig.sandbox.paneIds().includes(pane));
    await waitUntil(() => !isProcessAlive(panePid));
  });

  it("leaves the pane alone without closeTab, with an empty body or closeTab false", async () => {
    const { pane, panePid } = rig.sandbox.start("sh -c 'sleep 300; exec sleep 300'");
    const claudePid = await rig.sandbox.childOf(panePid);
    const { id } = await seed(claudePid);
    expect(await kill(id, { closeTab: false })).toEqual({ ok: true, closed: "none" });
    expect(rig.sandbox.paneIds()).toContain(pane);
    await sleep(50);
    await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/kill`, 409, "conflict");
    expect(rig.sandbox.paneIds()).toContain(pane);
  });

  it("accepts a kill without any body", async () => {
    const pid = rig.daemon.home.spawnLive();
    const { id } = await seed(pid);
    expect(await kill(id)).toEqual({ ok: true, closed: "none" });
    expect(await rig.daemon.call("POST", `/v1/sessions/${id}/kill`, "{nope").then((r) => r.status)).toBe(400);
  });
});

describe("kill with closeTab in a terminal tab", () => {
  it("hangs up the login shell that is the direct child of a terminal app, and reports tab", async () => {
    const tab = await rig.tab("ghostty");
    const { id } = await seed(tab.claudePid);
    expect(await kill(id, { closeTab: true })).toEqual({ ok: true, closed: "tab" });
    expect(isProcessAlive(tab.claudePid)).toBe(false);
    await waitUntil(() => !isProcessAlive(tab.shellPid));
  });

  it("does nothing to the shell when the parent chain is not a terminal tab", async () => {
    const tab = await rig.tab("some-launcher");
    const { id } = await seed(tab.claudePid);
    expect(await kill(id, { closeTab: true })).toEqual({ ok: true, closed: "none" });
    expect(isProcessAlive(tab.claudePid)).toBe(false);
    expect(isProcessAlive(tab.shellPid)).toBe(true);
  });

  it("keeps the shell when closeTab is not asked for", async () => {
    const tab = await rig.tab("ghostty");
    const { id } = await seed(tab.claudePid);
    expect(await kill(id)).toEqual({ ok: true, closed: "none" });
    expect(isProcessAlive(tab.shellPid)).toBe(true);
  });
});
