import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectApiError } from "../../test/support/apiAssert.js";
import { waitUntil } from "../../test/support/env.js";
import { useRig } from "../../test/support/terminalRig.js";
import { actionResultSchema } from "../contract/schema.js";
import { CLEAR_WAIT_MS } from "../service/clear.js";

const TERMINAL_ID = "7C1F0E2A-1111-4000-8000-0000000000AA";
const NEW_ID = "00000000-0000-4000-8000-00000000c1ea";
const rig = useRig();

const collector = (file: string): string => `sh -c 'while IFS= read -r line; do printf "%s\\n" "$line" >> ${file}; done; true'`;
const typedInto = (file: string): string => readFileSync(file, { encoding: "utf8", flag: "a+" });

/** What Claude Code does after /clear: the same process registers under a new session id. */
function registerNewSession(pid: number): void {
  rig.daemon.home.addRegistry({ fixture: "idle", sessionId: NEW_ID, pid, overrides: { messagingSocketPath: null } });
}

describe("POST /v1/sessions/:id/clear in a tmux pane", () => {
  it("types /clear and answers the new session id once the registry shows it", async () => {
    const file = join(rig.daemon.config.stateDir, "typed.txt");
    const { panePid } = rig.sandbox.start(collector(file));
    const { id } = await rig.seed(panePid);
    const response = rig.daemon.call("POST", `/v1/sessions/${id}/clear`);
    await waitUntil(() => typedInto(file) === "/clear\n");
    registerNewSession(panePid);
    const answered = await response;
    expect(answered.status).toBe(200);
    expect(actionResultSchema.parse(answered.json)).toEqual({ sessionId: NEW_ID });
    expect(rig.inbox.received).toEqual([]);
  });

  it("answers internal in plain words when the registry never shows a new session", async () => {
    const file = join(rig.daemon.config.stateDir, "typed.txt");
    const { panePid } = rig.sandbox.start(collector(file));
    const { id } = await rig.seed(panePid);
    const message = await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/clear`, 500, "internal");
    expect(message).toContain(`did not start a new session within ${CLEAR_WAIT_MS / 1000} s`);
    expect(typedInto(file)).toBe("/clear\n");
  }, CLEAR_WAIT_MS + 45_000);
});

describe("POST /v1/sessions/:id/clear outside tmux", () => {
  it("types into the matched Ghostty terminal", async () => {
    const tab = await rig.tab("ghostty");
    rig.osascript.setTerminals([{ id: TERMINAL_ID, tty: "/dev/ttys778", pid: tab.claudePid, cwd: "/ours" }]);
    const { id } = await rig.seed(tab.claudePid, { messagingSocketPath: null });
    await waitUntil(() => rig.daemon.services.sessions().find((session) => session.id === id)?.replyMode === "composer");
    const response = rig.daemon.call("POST", `/v1/sessions/${id}/clear`);
    await waitUntil(() => rig.osascript.typed().length === 1);
    registerNewSession(tab.claudePid);
    expect(actionResultSchema.parse((await response).json)).toEqual({ sessionId: NEW_ID });
    expect(rig.osascript.typed()).toEqual([["/clear", TERMINAL_ID]]);
  });

  it("answers conflict for a session that has ended", async () => {
    const pid = rig.daemon.home.spawnLive();
    const { id } = await rig.seed(pid);
    await rig.daemon.home.killLive(pid);
    await waitUntil(() => rig.daemon.services.sessions().find((session) => session.id === id)?.status === "ended");
    expect(await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/clear`, 409, "conflict")).toContain("has ended");
  });
});

describe("POST /v1/sessions/:id/compact in a terminal", () => {
  it("types /compact into a tmux pane and answers the same session id", async () => {
    const file = join(rig.daemon.config.stateDir, "typed.txt");
    const { id } = await rig.seed(rig.sandbox.start(collector(file)).panePid);
    const answered = await rig.daemon.call("POST", `/v1/sessions/${id}/compact`);
    expect(answered.status).toBe(200);
    expect(actionResultSchema.parse(answered.json)).toEqual({ sessionId: id });
    await waitUntil(() => typedInto(file) === "/compact\n");
    expect(rig.inbox.received).toEqual([]);
  });

  it("types /compact into the matched Ghostty terminal", async () => {
    const tab = await rig.tab("ghostty");
    rig.osascript.setTerminals([{ id: TERMINAL_ID, tty: "/dev/ttys779", pid: tab.claudePid, cwd: "/ours" }]);
    const { id } = await rig.seed(tab.claudePid, { messagingSocketPath: null });
    await waitUntil(() => rig.daemon.services.sessions().find((session) => session.id === id)?.replyMode === "composer");
    const answered = await rig.daemon.call("POST", `/v1/sessions/${id}/compact`);
    expect(actionResultSchema.parse(answered.json)).toEqual({ sessionId: id });
    expect(rig.osascript.typed()).toEqual([["/compact", TERMINAL_ID]]);
  });
});

const COMMANDS = [
  { command: "clear", hint: "Use Take Over, then Clear." },
  { command: "compact", hint: "Use Take Over first." },
];

describe.each(COMMANDS)("POST /v1/sessions/:id/$command, shared refusals", ({ command, hint }) => {
  it("refuses to type into a pane that waits at a permission dialog", async () => {
    const never = join(rig.daemon.config.stateDir, "never.txt");
    const { id } = await rig.seed(rig.sandbox.start(collector(never)).panePid, { waitingFor: "tool approval", status: "waiting" });
    const refusal = await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/${command}`, 409, "conflict");
    expect(refusal).toContain("waiting for a permission answer");
    expect(typedInto(never)).toBe("");
  });

  it("answers unsupported with the take-over hint for a plain terminal and not_found for an unknown session", async () => {
    const { id } = await rig.seed(rig.daemon.home.spawnLive());
    const title = rig.daemon.services.sessions().find((session) => session.id === id)?.title ?? "";
    const message = await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/${command}`, 501, "unsupported");
    expect(message).toBe(`${title} on test-mac runs outside tmux and Ghostty: /${command} can only be typed there. ${hint}`);
    await expectApiError(rig.daemon, "POST", `/v1/sessions/nope/${command}`, 404, "not_found");
  });

  it("refuses a message that is exactly the command, with or without surrounding blanks, and points to the route", async () => {
    const { id } = await rig.seed(rig.daemon.home.spawnLive());
    for (const text of [`/${command}`, `  /${command}\n`]) {
      expect(await expectApiError(rig.daemon, "POST", `/v1/sessions/${id}/message`, 400, "invalid_request", { text })).toContain(`/${command}`);
    }
    expect(rig.inbox.received).toEqual([]);
  });
});

