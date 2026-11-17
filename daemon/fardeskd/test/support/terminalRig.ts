// Shared set-up for the terminal tests: a daemon on a private tmux server with a real inbox socket and a stand-in osascript.
import { appendFileSync } from "node:fs";
import { afterEach, beforeEach } from "vitest";
import { startTestDaemon } from "./daemon.js";
import type { TestDaemon } from "./daemon.js";
import { waitUntil } from "./env.js";
import { createFakeOsascript } from "./fakeOsascript.js";
import type { FakeOsascript } from "./fakeOsascript.js";
import { startInbox } from "./inboxServer.js";
import type { InboxServer } from "./inboxServer.js";
import { createTmuxSandbox, startFakeTab } from "./terminals.js";
import type { FakeTab, TmuxSandbox } from "./terminals.js";

const PROMPTING = "02-interrupt-denied-bash-error";
export const FAST_INTERVALS = { registryPollMs: 100, transcriptPollMs: 50, pingMs: 60_000, typablePollMs: 150 };

export type Seeded = { id: string; transcript: string };

export type TerminalRig = {
  sandbox: TmuxSandbox;
  osascript: FakeOsascript;
  inbox: InboxServer;
  daemon: TestDaemon;
  /** Registers a live session whose claude process is `pid` (defaults: idle, inbox socket set). */
  seed(pid: number, overrides?: Record<string, unknown>): Promise<Seeded>;
  /** A fake `ghostty -> zsh -> claude` tab. */
  tab(terminalName: string): Promise<FakeTab>;
  dispose(): Promise<void>;
};

/** A live idle session (its claude process is `pid`, or a fresh live child) whose inbox appends delivered messages to its transcript. */
export async function seedSession(daemon: TestDaemon, inbox: InboxServer, overrides: Record<string, unknown> = {}, pid?: number): Promise<Seeded> {
  const { sessionId, path } = daemon.home.addTranscript({ fixture: PROMPTING });
  daemon.home.addRegistry({ fixture: "idle", sessionId, ...(pid === undefined ? {} : { pid }), overrides: { messagingSocketPath: inbox.socketPath, ...overrides } });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  inbox.setTranscript(path);
  return { id: sessionId, transcript: path };
}

export async function startRig(): Promise<TerminalRig> {
  const sandbox = createTmuxSandbox();
  const osascript = createFakeOsascript();
  const inbox = await startInbox(true, null);
  const daemon = await startTestDaemon({ tmuxBinary: sandbox.binary, osascriptBinary: osascript.binary, intervals: FAST_INTERVALS });
  const tabs: FakeTab[] = [];
  return {
    sandbox,
    osascript,
    inbox,
    daemon,
    seed: async (pid, overrides = {}) => seedSession(daemon, inbox, overrides, pid),
    async tab(terminalName): Promise<FakeTab> {
      const tab = await startFakeTab(terminalName);
      tabs.push(tab);
      return tab;
    },
    async dispose(): Promise<void> {
      await daemon.close();
      await inbox.close();
      for (const tab of tabs.splice(0)) tab.dispose();
      sandbox.dispose();
    },
  };
}

/** What Claude Code writes to the transcript when it takes a typed message. */
export function appendUserLine(path: string, text: string): void {
  appendFileSync(path, `${JSON.stringify({ type: "user", uuid: `u-${Date.now()}`, timestamp: new Date().toISOString(), isSidechain: false, message: { role: "user", content: text } })}\n`);
}

/** Registers beforeEach/afterEach that start and dispose a rig; the returned object always points at the current one. */
export function useRig(): TerminalRig {
  let current: TerminalRig | null = null;
  beforeEach(async () => {
    current = await startRig();
  });
  afterEach(async () => {
    await current?.dispose();
    current = null;
  });
  return new Proxy({} as TerminalRig, {
    get(_target, key): unknown {
      if (current === null) throw new Error("the terminal rig is only available inside a test");
      return Reflect.get(current, key) as unknown;
    },
  });
}
