// The automatic colour of every session, assigned once in creation order and kept in a strict JSON state file, so
// it stays the same across restarts and on every device. Same helper as the label and mute stores.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";
import { labelColorSchema } from "../contract/schema.js";
import { pickAutoColour } from "./autoColour.js";

const fileSchema = z.strictObject({ colors: z.record(z.string().min(1), labelColorSchema) });

export type AutoColourInput = { id: string; startedAtMs: number; userColor: string | null };

export type AutoColourStore = {
  get(sessionId: string): string | null;
  /**
   * Gives every read session (`sessions`: those with a start time) without a colour one, oldest first.
   * `presentIds` are all sessions that exist, read or not: only stored colours of ids outside it are forgotten,
   * and the stored colours of present but unread sessions count as taken.
   */
  assign(sessions: readonly AutoColourInput[], presentIds: readonly string[]): void;
};

const byCreation = (a: AutoColourInput, b: AutoColourInput): number => a.startedAtMs - b.startedAtMs || a.id.localeCompare(b.id);

/** The colour each session shows: the user's pick, else its automatic colour. */
function shownColours(sessions: readonly AutoColourInput[], colors: Readonly<Record<string, string>>): string[] {
  return sessions.flatMap((session) => {
    const shown = session.userColor ?? colors[session.id];
    return shown === undefined ? [] : [shown];
  });
}

export function createAutoColourStore(path: string): AutoColourStore {
  let colors: Record<string, string> = readJsonState(path, fileSchema, "auto colour store", { colors: {} }).colors;
  return {
    get: (sessionId): string | null => colors[sessionId] ?? null,
    assign(sessions, presentIds): void {
      if (presentIds.length === 0) return;
      const present = new Set(presentIds);
      const next: Record<string, string> = Object.fromEntries(Object.entries(colors).filter(([id]) => present.has(id)));
      const read = new Set(sessions.map((session) => session.id));
      const unread = Object.entries(next).filter(([id]) => !read.has(id)).map(([, colour]) => colour);
      const taken = [...shownColours(sessions, next), ...unread];
      for (const session of sessions.filter((candidate) => next[candidate.id] === undefined).toSorted(byCreation)) {
        const colour = pickAutoColour(taken);
        next[session.id] = colour;
        if (session.userColor === null) taken.push(colour);
      }
      if (JSON.stringify(next) === JSON.stringify(colors)) return;
      writeJsonState(path, { colors: Object.fromEntries(Object.entries(next).toSorted(([a], [b]) => a.localeCompare(b))) });
      colors = next;
    },
  };
}
