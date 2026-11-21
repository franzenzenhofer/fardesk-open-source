// A live process missing from one registry poll must not cancel what the phone was asked (#87): readClaudeRegistry
// skips a file it cannot parse (a partial write), so one bad read looks exactly like a process that is gone.
import { writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { quietStoreDeps } from "../../test/support/storeDeps.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { createSessionStore } from "./store.js";
import type { SessionStore } from "./store.js";

const SESSION = "14141414-1414-4141-8141-141414141414";
const HALF_WRITTEN = '{"pid":';
const disposers: (() => void)[] = [];

afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose();
});

function waitingSession(): { home: ClaudeHome; store: SessionStore; left: string[]; pid: number; path: string } {
  const home = createClaudeHome();
  disposers.push(() => { home.dispose(); });
  const { pid, path } = home.addRegistry({ fixture: "busy", sessionId: SESSION, overrides: { status: "waiting" } });
  const left: string[] = [];
  const store = createSessionStore(quietStoreDeps(home.dir, { onLeftWaiting: (id) => left.push(id) }));
  disposers.push(() => { store.close(); });
  return { home, store, left, pid, path };
}

describe("a live process missing from the registry", () => {
  it("is not reported as gone after one unparseable poll, and recovers", () => {
    const { home, store, left, pid, path } = waitingSession();
    writeFileSync(path, HALF_WRITTEN);
    store.refresh();
    expect(left).toEqual([]);
    home.addRegistry({ fixture: "busy", sessionId: SESSION, pid, overrides: { status: "waiting" } });
    store.refresh();
    store.refresh();
    expect(left).toEqual([]);
    expect(store.get(SESSION).summary.status).toBe("waiting");
  });

  it("is reported as gone after two polls in a row without it", () => {
    const { home, store, left, pid, path } = waitingSession();
    writeFileSync(path, HALF_WRITTEN);
    store.refresh();
    expect(left).toEqual([]);
    store.refresh();
    expect(left).toEqual([SESSION]);
    home.removeRegistry(pid);
    store.refresh();
    expect(left).toEqual([SESSION]);
  });

  it("is reported as gone at once when its pid is dead, whether its file is deleted or unparseable", async () => {
    const { home, store, left, pid, path } = waitingSession();
    await home.killLive(pid);
    writeFileSync(path, HALF_WRITTEN);
    store.refresh();
    expect(left).toEqual([SESSION]);
    const second = waitingSession();
    await second.home.killLive(second.pid);
    second.home.removeRegistry(second.pid);
    second.store.refresh();
    expect(second.left).toEqual([SESSION]);
  });
});
