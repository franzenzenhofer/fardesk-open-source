// Until when the user paused all pushes of this machine. Strict JSON state file, same helper as the mute store.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

const MS_PER_MINUTE = 60_000;
const pauseFileSchema = z.strictObject({ pausedUntil: z.iso.datetime().nullable() });

export type PauseStore = {
  /** ISO time the pause ends, or null when notifications are on (an elapsed pause counts as on). */
  pausedUntil(): string | null;
  isPaused(): boolean;
  /** Pauses for `minutes` from now; 0 resumes. Resolves to the new `pausedUntil`. */
  pause(minutes: number): string | null;
};

export function createPauseStore(path: string, now: () => Date): PauseStore {
  let stored = readJsonState(path, pauseFileSchema, "pause store", { pausedUntil: null }).pausedUntil;
  const pausedUntil = (): string | null => (stored !== null && Date.parse(stored) > now().getTime() ? stored : null);
  return {
    pausedUntil,
    isPaused: (): boolean => pausedUntil() !== null,
    pause(minutes): string | null {
      stored = minutes === 0 ? null : new Date(now().getTime() + minutes * MS_PER_MINUTE).toISOString();
      writeJsonState(path, { pausedUntil: stored });
      return stored;
    },
  };
}
