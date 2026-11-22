// Which stopped sessions the user removed from the list. Strict JSON state file `{ "hidden": [ids...] }`.
import { createIdSetStore } from "./idSetStore.js";

export type HiddenStore = {
  isHidden(sessionId: string): boolean;
  /** Every hidden session id. */
  ids(): ReadonlySet<string>;
  set(sessionId: string, hidden: boolean): void;
};

export function createHiddenStore(path: string): HiddenStore {
  const store = createIdSetStore(path, "hidden", "hidden sessions store");
  return { isHidden: (sessionId): boolean => store.has(sessionId), ids: (): ReadonlySet<string> => store.ids(), set: (sessionId, hidden): void => { store.set(sessionId, hidden); } };
}
