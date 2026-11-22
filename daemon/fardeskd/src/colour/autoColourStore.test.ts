import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { makeTempDir } from "../../test/support/env.js";
import { quietStoreDeps } from "../../test/support/storeDeps.js";
import { LABEL_PRESETS } from "../contract/palette.js";
import { NO_LABEL } from "../service/labelStore.js";
import { createSessionStore } from "../sessions/store.js";
import type { StoreDeps } from "../sessions/store.js";
import { createAutoColourStore } from "./autoColourStore.js";

const SESSION_COUNT = 64;
const idOf = (index: number): string => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const newStatePath = (): string => join(makeTempDir(), "auto-colours.json");

/** A real Claude home with `count` ended sessions, removed again when `run` is done. */
function withSessions(count: number, run: (home: ClaudeHome) => void): void {
  const home = createClaudeHome();
  try {
    for (let index = 0; index < count; index++) home.addTranscript({ fixture: "01-simple-session", sessionId: idOf(index) });
    run(home);
  } finally {
    home.dispose();
  }
}

/** Opens a real session store over the home with a real auto colour store on `statePath`, reads the colours and closes it: a daemon start. */
function startAndRead(home: ClaudeHome, statePath: string, overrides: Partial<StoreDeps> = {}): Record<string, string | null> {
  const store = createSessionStore(quietStoreDeps(home.dir, {
    limits: { maxEnded: 200, maxEndedReadsPerRefresh: 200, maxFolders: 10 },
    ...overrides,
    autoColors: createAutoColourStore(statePath),
  }));
  try {
    return Object.fromEntries(store.list().map((session) => [session.id, session.autoColor]));
  } finally {
    store.close();
  }
}

describe("automatic colours of a real session store", () => {
  it("gives 64 sessions 64 different presets, the same ones on every run, and keeps them across a restart", () => {
    withSessions(SESSION_COUNT, (home) => {
      const statePath = newStatePath();
      const first = startAndRead(home, statePath);
      expect(Object.keys(first)).toHaveLength(SESSION_COUNT);
      expect(new Set(Object.values(first)).size).toBe(SESSION_COUNT);
      const presets = new Set(LABEL_PRESETS.map((preset) => preset.color));
      expect(Object.values(first).every((colour) => colour !== null && presets.has(colour))).toBe(true);
      expect(startAndRead(home, newStatePath())).toEqual(first);
      expect(startAndRead(home, statePath)).toEqual(first);
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as { colors: Record<string, string> };
      expect(Object.keys(saved.colors)).toHaveLength(SESSION_COUNT);
    });
  });

  it("keeps every untouched colour across a restart that reads fewer transcripts than there are sessions", () => {
    const sessionCount = 40;
    const readsPerPoll = 20;
    withSessions(sessionCount, (home) => {
      const statePath = newStatePath();
      const first = startAndRead(home, statePath);
      const picked = new Set([idOf(3), idOf(11), idOf(25), idOf(38)]);
      const userPick = { ...NO_LABEL, color: "#000000" };
      const second = startAndRead(home, statePath, {
        limits: { maxEnded: 200, maxEndedReadsPerRefresh: readsPerPoll, maxFolders: 10 },
        labelOf: (id) => (picked.has(id) ? userPick : NO_LABEL),
      });
      expect(Object.keys(second)).toHaveLength(readsPerPoll);
      for (const [id, colour] of Object.entries(second)) expect(colour).toBe(first[id]);
      const saved = JSON.parse(readFileSync(statePath, "utf8")) as { colors: Record<string, string> };
      expect(saved.colors).toEqual(first);
    });
  });

  it("keeps the colour of a session when a new one arrives", () => {
    withSessions(3, (home) => {
      const statePath = newStatePath();
      const before = startAndRead(home, statePath);
      home.addTranscript({ fixture: "01-simple-session", sessionId: idOf(999) });
      const after = startAndRead(home, statePath);
      for (const [id, colour] of Object.entries(before)) expect(after[id]).toBe(colour);
      expect(Object.keys(after)).toHaveLength(4);
      expect(new Set(Object.values(after)).size).toBe(4);
    });
  });

  it("fails loudly on a corrupt colour file", () => {
    const path = newStatePath();
    writeFileSync(path, JSON.stringify({ colors: { a: "blue" } }));
    expect(() => createAutoColourStore(path)).toThrow(/auto colour store/);
  });
});
