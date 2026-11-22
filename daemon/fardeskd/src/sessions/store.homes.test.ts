import { afterEach, describe, expect, it } from "vitest";
import { quietStoreDeps } from "../../test/support/storeDeps.js";
import { trackHomes } from "../../test/support/trackedHomes.js";
import { createSessionStore } from "./store.js";
import type { SessionStore } from "./store.js";

const LIVE_ID = "88888888-8888-4888-8888-888888888888";
const ENDED_ID = "99999999-9999-4999-8999-999999999999";
const tracker = trackHomes();
const open: SessionStore[] = [];

afterEach(() => {
  tracker.disposeAll();
  for (const store of open.splice(0)) store.close();
});

describe("sessions of two Claude homes (#61)", () => {
  it("names the home of every session, live or ended, by its configured name and never by its path", () => {
    const work = tracker.newHome();
    const other = tracker.newHome();
    work.addTranscript({ fixture: "01-simple-session", sessionId: LIVE_ID });
    work.addRegistry({ fixture: "idle", sessionId: LIVE_ID });
    other.addTranscript({ fixture: "01-simple-session", sessionId: ENDED_ID });
    const claudeHomes = [{ path: work.dir, name: "work" }, { path: other.dir, name: "other" }];
    const store = createSessionStore(quietStoreDeps(work.dir, { claudeHomes }));
    open.push(store);
    expect(new Map(store.list().map((session) => [session.id, session.home]))).toEqual(new Map([[LIVE_ID, "work"], [ENDED_ID, "other"]]));
    expect(JSON.stringify(store.list())).not.toContain(work.dir);
    expect(store.get(ENDED_ID).home).toBe(other.dir);
  });

  it("follows a home that is renamed in the shared list", () => {
    const work = tracker.newHome();
    work.addTranscript({ fixture: "01-simple-session", sessionId: ENDED_ID });
    const claudeHomes = [{ path: work.dir, name: "work" }];
    const store = createSessionStore(quietStoreDeps(work.dir, { claudeHomes }));
    open.push(store);
    claudeHomes.splice(0, 1, { path: work.dir, name: "renamed" });
    store.refresh();
    expect(store.list().map((session) => session.home)).toEqual(["renamed"]);
  });
});
