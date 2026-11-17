import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { waitUntil } from "../../test/support/env.js";
import { createFakeOsascript } from "../../test/support/fakeOsascript.js";
import { writeWrapper } from "../../test/support/terminals.js";
import { runCommand, runCommandWithInput } from "../config/bind.js";
import { createBus } from "../core/bus.js";
import { createLogger } from "../core/log.js";
import { createGhostty } from "../foreign/ghostty.js";
import { createSessionStore } from "../sessions/store.js";
import type { SessionStore } from "../sessions/store.js";
import { createTypableWatch } from "./typable.js";
import type { TypableWatch } from "./typable.js";

const closers: (() => void)[] = [];

afterEach(() => {
  for (const close of closers.splice(0).reverse()) close();
});

type Rig = { watch: TypableWatch; store: SessionStore; home: ClaudeHome; commands: string[]; typable: Set<number> };

function rig(): Rig {
  const home = createClaudeHome();
  const commands: string[] = [];
  const log = createLogger(() => undefined, () => new Date());
  const run = async (command: string, args: string[]): Promise<string> => {
    commands.push(command);
    return runCommand(command, args);
  };
  const store = createSessionStore({
    claudeHomes: [home.dir],
    bus: createBus(),
    log,
    registryPollMs: 50,
    transcriptPollMs: 20,
    summaryMaxChars: 80,
    limits: { maxEnded: 100, maxEndedReadsPerRefresh: 100, maxFolders: 10 },
    isOwned: () => false,
    isBusy: () => false,
    pendingKind: () => null,
    isMuted: () => false,
    onLeftWaiting: () => undefined,
  });
  const osascript = createFakeOsascript();
  const ghostty = createGhostty({ stateDir: home.dir, osascriptBinary: osascript.binary, run, log, cacheMs: 1_000, timeoutMs: 2_000, now: Date.now });
  const deps = { tmuxBinary: writeWrapper().binary, run, runWithInput: runCommandWithInput, ghostty, log };
  const typable = new Set<number>();
  const watch = createTypableWatch({ deps, store, typable, intervalMs: 60_000, now: Date.now });
  closers.push(() => { watch.close(); store.close(); home.dispose(); });
  return { watch, store, home, commands, typable };
}

describe("typable watch", () => {
  it("spawns no ps or tmux while there is no unowned live session, and forgets stale pids", async () => {
    const { watch, commands, typable } = rig();
    typable.add(424_242);
    await watch.refresh();
    expect(commands).toEqual([]);
    expect(typable.size).toBe(0);
  });

  it("looks at the process table once a live session exists", async () => {
    const { watch, store, home, commands } = rig();
    const { sessionId } = home.addTranscript({ fixture: "01b-minimal-session" });
    home.addRegistry({ fixture: "busy", sessionId, pid: home.spawnLive() });
    await waitUntil(() => store.list().some((session) => session.id === sessionId));
    await watch.refresh();
    expect(commands).toContain("ps");
  });
});
