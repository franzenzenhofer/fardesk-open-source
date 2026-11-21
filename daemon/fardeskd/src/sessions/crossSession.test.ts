import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { waitUntil } from "../../test/support/env.js";
import { quietStoreDeps } from "../../test/support/storeDeps.js";
import { acceptsCrossSession, readCrossSessionInbound } from "./crossSession.js";
import { createSessionStore } from "./store.js";
import type { SessionStore } from "./store.js";

const SESSION = "11111111-1111-4111-8111-111111111111";
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function writeSettings(home: ClaudeHome, content: string): void {
  writeFileSync(join(home.dir, "settings.json"), content);
}

function bypassStore(): { home: ClaudeHome; store: SessionStore } {
  const home = createClaudeHome();
  disposers.push(() => { home.dispose(); });
  home.addTranscript({ fixture: "01-simple-session", sessionId: SESSION });
  home.addRegistry({ fixture: "idle", sessionId: SESSION });
  const store = createSessionStore(quietStoreDeps(home.dir, { registryPollMs: 50, limits: { maxEnded: 10, maxEndedReadsPerRefresh: 10, maxFolders: 5 } }));
  disposers.push(() => { store.close(); });
  return { home, store };
}

describe("readCrossSessionInbound", () => {
  it("is lenient: missing file, broken JSON, wrong types and other values are not accepted", () => {
    const home = createClaudeHome();
    disposers.push(() => { home.dispose(); });
    expect(readCrossSessionInbound(home.dir)).toBeNull();
    writeSettings(home, "{broken");
    expect(readCrossSessionInbound(home.dir)).toBeNull();
    writeSettings(home, "[1]");
    expect(readCrossSessionInbound(home.dir)).toBeNull();
    writeSettings(home, JSON.stringify({ crossSessionInbound: 5 }));
    expect(acceptsCrossSession(home.dir)).toBe(false);
    writeSettings(home, JSON.stringify({ crossSessionInbound: "ask" }));
    expect(acceptsCrossSession(home.dir)).toBe(false);
    writeSettings(home, JSON.stringify({ crossSessionInbound: "accept" }));
    expect(acceptsCrossSession(home.dir)).toBe(true);
  });
});

describe("bypass-mode reply mode follows crossSessionInbound, re-read on every refresh", () => {
  it("takeover without the setting, composer with accept, takeover again after it is removed", () => {
    const { home, store } = bypassStore();
    expect(store.get(SESSION).summary.replyMode).toBe("takeover");
    writeSettings(home, JSON.stringify({ crossSessionInbound: "accept" }));
    store.refresh();
    expect(store.get(SESSION).summary.replyMode).toBe("composer");
    writeSettings(home, JSON.stringify({}));
    store.refresh();
    expect(store.get(SESSION).summary.replyMode).toBe("takeover");
  });

  it("the poll timer picks the change up without an explicit refresh", async () => {
    const { home, store } = bypassStore();
    writeSettings(home, JSON.stringify({ crossSessionInbound: "accept" }));
    await waitUntil(() => store.get(SESSION).summary.replyMode === "composer");
  });
});
