// Which sessions the user muted (no pushes). Strict JSON state file, same helper as the device store.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

const muteFileSchema = z.strictObject({ muted: z.array(z.string().min(1)) });

export type MuteStore = {
  isMuted(sessionId: string): boolean;
  set(sessionId: string, muted: boolean): void;
};

export function createMuteStore(path: string): MuteStore {
  const muted = new Set(readJsonState(path, muteFileSchema, "mute store", { muted: [] }).muted);
  return {
    isMuted: (sessionId): boolean => muted.has(sessionId),
    set(sessionId, value): void {
      const next = new Set(muted);
      if (value) next.add(sessionId);
      else next.delete(sessionId);
      writeJsonState(path, { muted: [...next].sort() });
      muted.clear();
      for (const id of next) muted.add(id);
    },
  };
}
