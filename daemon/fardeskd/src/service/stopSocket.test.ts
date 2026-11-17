import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { expectStopSendsEscape } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { writePlainWrapper } from "../../test/support/terminals.js";

let daemon: TestDaemon | undefined;
let server: string | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
  if (server !== undefined) {
    try {
      execFileSync("tmux", ["-L", server, "kill-server"], { stdio: "ignore" });
    } catch {
      // the server already exited
    }
    server = undefined;
  }
});

describe("stop of a session in a tmux pane on a non-default server", () => {
  it("sends Escape through the server that holds the pane, not the default one", async () => {
    daemon = await startTestDaemon({ tmuxBinary: writePlainWrapper() });
    const name = `fardesk-test-${Math.random().toString(36).slice(2, 10)}`;
    server = name;
    const target = join(daemon.config.stateDir, "escape.bin");
    const command = `sh -c 'stty raw -echo; head -c1 > ${target}; true'`;
    const panePid = Number(execFileSync("tmux", ["-L", name, "new-session", "-d", "-P", "-F", "#{pane_pid}", command], { encoding: "utf8" }).trim());
    let headPid = 0;
    await waitUntil(() => {
      headPid = childOf(panePid);
      return headPid > 0;
    });
    const paneId = execFileSync("tmux", ["-L", name, "list-panes", "-a", "-F", "#{pane_id}"], { encoding: "utf8" }).trim();
    const { sessionId } = daemon.home.addTranscript({ fixture: "01b-minimal-session" });
    daemon.home.addRegistry({ fixture: "busy", sessionId, pid: headPid, overrides: { tmux: paneId } });
    const { id } = await waitUntilListed(daemon, sessionId);
    await expectStopSendsEscape(daemon, id, target);
  });
});

async function waitUntilListed(live: TestDaemon, sessionId: string): Promise<{ id: string }> {
  await waitUntil(() => live.services.sessions().some((session) => session.id === sessionId));
  return { id: sessionId };
}

function childOf(parent: number): number {
  try {
    return Number(execFileSync("pgrep", ["-P", String(parent)], { encoding: "utf8" }).split("\n")[0] ?? "0");
  } catch {
    return 0;
  }
}
