import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import { fixturePath, makeTempDir, waitUntil } from "../../test/support/env.js";
import { neverStartingDeps } from "../../test/support/ownedDeps.js";
import { findTranscripts } from "../sessions/transcriptFiles.js";
import { createOwnedRunner } from "./runner.js";
import { createStateFile } from "./stateFile.js";

const FAKE_CLAUDE = fixturePath("..", "support", "fakeClaude.sh");
const MODEL = null;

const [homeA, homeB, homeStray] = [createClaudeHome(), createClaudeHome(), createClaudeHome()] as const;
afterAll(() => {
  for (const home of [homeA, homeB, homeStray]) home.dispose();
});
afterEach(() => {
  delete process.env.FAKE_CLAUDE_LOG;
});

function setup(): { dir: string; log: string; deps: ReturnType<typeof neverStartingDeps> } {
  const dir = makeTempDir("fd-restore-");
  const log = join(dir, "started.log");
  process.env.FAKE_CLAUDE_LOG = log;
  const claudeHomes = [{ path: homeA.dir, name: "a" }, { path: homeB.dir, name: "b" }];
  return { dir, log, deps: neverStartingDeps(dir, { claudeHomes, claudeBinary: FAKE_CLAUDE }) };
}

describe("restoring owned sessions", () => {
  it("resumes in the configured home holding the transcript and drops one found only in an unconfigured folder", async () => {
    const { dir, log, deps } = setup();
    const inB = homeB.addTranscript({ fixture: "01b-minimal-session" });
    const stray = homeStray.addTranscript({ fixture: "01b-minimal-session" });
    createStateFile(deps.statePath).write([
      { sessionId: inB.sessionId, cwd: dir, model: MODEL },
      { sessionId: stray.sessionId, cwd: dir, model: MODEL },
    ]);
    const runner = createOwnedRunner(deps);
    await runner.restore();
    expect(runner.isOwned(inB.sessionId)).toBe(true);
    expect(runner.isOwned(stray.sessionId)).toBe(false);
    await waitUntil(() => existsSync(log), 10_000);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([homeB.dir]);
    expect(createStateFile(deps.statePath).read()).toEqual([{ sessionId: inB.sessionId, cwd: dir, model: MODEL }]);
    await runner.close();
  });
});

describe("forking an owned session", () => {
  it("writes the copy into the home of its source and resumes it there", async () => {
    const { dir, log, deps } = setup();
    const cwd = realpathSync(dir);
    const source = homeB.addTranscript({ fixture: "01b-minimal-session", projectDir: cwd.replace(/[^a-zA-Z0-9]/g, "-") });
    const runner = createOwnedRunner({ ...deps, findHome: () => homeB.dir, findCwd: () => cwd });
    const copy = await runner.fork(source.sessionId);
    expect(copy).not.toBe(source.sessionId);
    expect(findTranscripts(homeB.dir).map((ref) => ref.sessionId)).toContain(copy);
    expect(findTranscripts(homeA.dir)).toEqual([]);
    await waitUntil(() => existsSync(log), 10_000);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([homeB.dir]);
    await runner.close();
  });
});
