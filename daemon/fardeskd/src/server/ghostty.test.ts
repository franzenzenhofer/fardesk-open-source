import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { appendUserLine, FAST_INTERVALS, seedSession, useRig } from "../../test/support/terminalRig.js";
import type { Seeded } from "../../test/support/terminalRig.js";
import { writePlainWrapper } from "../../test/support/terminals.js";
import type { FakeTab } from "../../test/support/terminals.js";
import { ghosttyProbeResultSchema, killResultSchema, machineSchema } from "../contract/schema.js";
import { isProcessAlive } from "../sessions/processes.js";

const TERMINAL_ID = "7C1F0E2A-1111-4000-8000-0000000000AA";
const OTHER_TERMINAL_ID = "7C1F0E2A-2222-4000-8000-0000000000BB";
const NO_INBOX = { messagingSocketPath: null };
const rig = useRig();

const seed = async (pid: number, overrides: Record<string, unknown> = {}): Promise<Seeded> => rig.seed(pid, overrides);
const replyModeOf = (id: string): string | undefined => rig.daemon.services.sessions().find((session) => session.id === id)?.replyMode;

async function ghosttyTab(): Promise<FakeTab> {
  const tab = await rig.tab("ghostty");
  rig.osascript.setTerminals([
    { id: OTHER_TERMINAL_ID, tty: "/dev/ttys777", pid: 1, cwd: "/not/ours" },
    { id: TERMINAL_ID, tty: "/dev/ttys778", pid: tab.claudePid, cwd: "/ours" },
  ]);
  return tab;
}

describe("machine status and the consent probe", () => {
  it("starts as unknown and answers ok after a successful listing", async () => {
    const before = machineSchema.parse((await rig.daemon.call("GET", "/v1/machine")).json);
    expect(before.ghosttyAutomation).toBe("unknown");
    const probe = await rig.daemon.call("POST", "/v1/machine/ghostty/probe");
    expect(ghosttyProbeResultSchema.parse(probe.json)).toEqual({ ghosttyAutomation: "ok" });
    expect(machineSchema.parse((await rig.daemon.call("GET", "/v1/machine")).json).ghosttyAutomation).toBe("ok");
  });

  it("answers denied when macOS refuses the Apple events (-1743)", async () => {
    rig.osascript.deny();
    const probe = await rig.daemon.call("POST", "/v1/machine/ghostty/probe");
    expect(ghosttyProbeResultSchema.parse(probe.json)).toEqual({ ghosttyAutomation: "denied" });
    expect(machineSchema.parse((await rig.daemon.call("GET", "/v1/machine")).json).ghosttyAutomation).toBe("denied");
  });
});

describe("reply into a Ghostty terminal", () => {
  it("shows composer without an inbox and types into the matched terminal only", async () => {
    const tab = await ghosttyTab();
    const { id, transcript } = await seed(tab.claudePid, NO_INBOX);
    await waitUntil(() => replyModeOf(id) === "composer");
    const delivery = rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text: "from the phone" });
    await waitUntil(() => rig.osascript.typed().length === 1);
    appendUserLine(transcript, "from the phone");
    expect((await delivery).status).toBe(200);
    expect(rig.osascript.typed()).toEqual([["from the phone", TERMINAL_ID]]);
    expect(rig.inbox.received).toEqual([]);
  });

  it("stays takeover while the process is not in any Ghostty terminal", async () => {
    const pid = rig.daemon.home.spawnLive();
    const { id } = await seed(pid, NO_INBOX);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(replyModeOf(id)).toBe("takeover");
  });

  it("refuses to type while the session waits at a permission dialog", async () => {
    const tab = await ghosttyTab();
    const { id } = await seed(tab.claudePid, { ...NO_INBOX, status: "waiting", waitingFor: "tool approval" });
    await waitUntil(() => replyModeOf(id) === "composer");
    expect(await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/message`, 409, "conflict", { text: "1" })).toContain("waiting for a permission answer");
    expect(rig.osascript.typed()).toEqual([]);
  });

  it("falls back to the inbox when Automation is denied and reports it in the machine status", async () => {
    const tab = await ghosttyTab();
    const { id } = await seed(tab.claudePid);
    rig.osascript.deny();
    const response = await rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text: "via inbox" });
    expect(response.status).toBe(200);
    expect(rig.inbox.received).toEqual(["via inbox"]);
    expect(rig.osascript.typed()).toEqual([]);
    expect(machineSchema.parse((await rig.daemon.call("GET", "/v1/machine")).json).ghosttyAutomation).toBe("denied");
  });

  it("refuses the inbox too while the session waits at a dialog (the dialog would eat the attachment lines)", async () => {
    const pid = rig.daemon.home.spawnLive();
    const { id } = await seed(pid, { status: "waiting", waitingFor: "tool approval" });
    await waitUntil(() => replyModeOf(id) === "composer");
    const text = "but not here\nAttached image: /work/.fardesk/attachments/a.png";
    expect(await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/message`, 409, "conflict", { text })).toContain("waiting for a permission answer");
    expect(rig.inbox.received).toEqual([]);
  });

  it("answers a conflict when Automation is denied and there is no inbox", async () => {
    const tab = await ghosttyTab();
    const { id } = await seed(tab.claudePid, NO_INBOX);
    await waitUntil(() => replyModeOf(id) === "composer");
    rig.osascript.deny();
    expect(await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/message`, 409, "conflict", { text: "x" })).toContain("cannot be typed into");
  });
});

describe("close tab through Ghostty", () => {
  it("closes the matched terminal instead of hanging up the shell, and answers tab", async () => {
    const tab = await ghosttyTab();
    const { id } = await seed(tab.claudePid);
    const response = await rig.daemon.call("POST", `/v1/sessions/${id}/kill`, { closeTab: true });
    expect(killResultSchema.parse(response.json)).toEqual({ ok: true, closed: "tab" });
    expect(rig.osascript.closed()).toEqual([TERMINAL_ID]);
    expect(isProcessAlive(tab.claudePid)).toBe(false);
    expect(isProcessAlive(tab.shellPid)).toBe(true);
  });

  it("hangs up the shell when Ghostty cannot be driven", async () => {
    const tab = await ghosttyTab();
    const { id } = await seed(tab.claudePid);
    rig.osascript.deny();
    const response = await rig.daemon.call("POST", `/v1/sessions/${id}/kill`, { closeTab: true });
    expect(killResultSchema.parse(response.json)).toEqual({ ok: true, closed: "tab" });
    expect(rig.osascript.closed()).toEqual([]);
    await waitUntil(() => !isProcessAlive(tab.shellPid));
  });
});

describe("tmux on any server", () => {
  it("finds the pane on a tmux -L server and types into it with no inbox", async () => {
    const file = join(rig.daemon.config.stateDir, "typed.txt");
    const { panePid } = rig.sandbox.start(`sh -c 'while IFS= read -r line; do printf "%s\\n" "$line" >> ${file}; done; true'`);
    const { id, transcript } = await seed(panePid, NO_INBOX);
    await waitUntil(() => replyModeOf(id) === "composer");
    const delivery = rig.daemon.call("POST", `/v1/sessions/${id}/message`, { text: "found by socket" });
    await waitUntil(() => readFileSync(file, { encoding: "utf8", flag: "a+" }).includes("found by socket"));
    appendUserLine(transcript, "found by socket");
    expect((await delivery).status).toBe(200);
  });

  it("discovers the server from its socket even when tmuxBinary knows nothing about it", async () => {
    const plain = await startTestDaemon({ tmuxBinary: writePlainWrapper(), intervals: FAST_INTERVALS });
    try {
      const file = join(plain.config.stateDir, "typed.txt");
      const { panePid } = rig.sandbox.start(`sh -c 'while IFS= read -r line; do printf "%s\\n" "$line" >> ${file}; done; true'`);
      const { id, transcript } = await seedSession(plain, rig.inbox, NO_INBOX, panePid);
      await waitUntil(() => plain.services.sessions().find((session) => session.id === id)?.replyMode === "composer");
      const delivery = plain.call("POST", `/v1/sessions/${id}/message`, { text: "other socket" });
      await waitUntil(() => readFileSync(file, { encoding: "utf8", flag: "a+" }).includes("other socket"));
      appendUserLine(transcript, "other socket");
      expect((await delivery).status).toBe(200);
    } finally {
      await plain.close();
    }
  });
});
