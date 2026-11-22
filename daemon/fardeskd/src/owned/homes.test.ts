import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { neverStartingDeps } from "../../test/support/ownedDeps.js";
import { CLAUDE_CONFIG_ENV } from "./claudeEnv.js";
import { startHome } from "./homes.js";
import { sessionOptions } from "./opener.js";
import { createOwnedRunner } from "./runner.js";

const WORK = { path: "/Users/dev/.claude-work", name: "work" };
const PRIVATE = { path: "/Users/dev/.claude-private", name: "private" };

describe("startHome", () => {
  it("picks the named home, the first home without a name, and refuses an unknown name", () => {
    expect(startHome([WORK, PRIVATE], "private")).toEqual(PRIVATE);
    expect(startHome([WORK, PRIVATE], undefined)).toEqual(WORK);
    expect(() => startHome([WORK, PRIVATE], "other")).toThrow(/unknown home "other".*"work", "private"/);
    expect(() => startHome([], undefined)).toThrow(/claudeHomes is empty/);
  });
});

describe("the environment of an owned session", () => {
  const request = { cwd: "/Users/dev/app", model: null, permissionMode: "default" as const, extra: {}, knownId: null };

  it("points claude at the home the session was opened in, so its transcript is written there", () => {
    const deps = neverStartingDeps(makeTempDir("fd-home-"), { claudeHomes: [WORK, PRIVATE] });
    expect(sessionOptions(deps, { ...request, home: PRIVATE.path }).env?.[CLAUDE_CONFIG_ENV]).toBe(PRIVATE.path);
    expect(sessionOptions(deps, { ...request, home: WORK.path }).env?.[CLAUDE_CONFIG_ENV]).toBe(WORK.path);
  });
});

describe("a runner with two homes", () => {
  it("refuses a new session for an unknown home before it starts any process", async () => {
    const dir = makeTempDir("fd-home-");
    const runner = createOwnedRunner(neverStartingDeps(dir, { claudeHomes: [WORK, PRIVATE] }));
    await expect(runner.start({ cwd: dir, prompt: "hi", worktree: false, model: null, home: "nowhere" })).rejects.toMatchObject({ code: "invalid_request" });
    await runner.close();
  });
});
