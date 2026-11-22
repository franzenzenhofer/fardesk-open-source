// Which sessions the user muted (no pushes). Strict JSON state file, same helper as the device store.
import { createIdSetStore } from "./idSetStore.js";

export type MuteStore = {
  isMuted(sessionId: string): boolean;
  set(sessionId: string, muted: boolean): void;
};

export function createMuteStore(path: string): MuteStore {
  const store = createIdSetStore(path, "muted", "mute store");
  return { isMuted: (sessionId): boolean => store.has(sessionId), set: (sessionId, muted): void => { store.set(sessionId, muted); } };
}
