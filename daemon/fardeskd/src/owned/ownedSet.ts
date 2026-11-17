import { FardeskError } from "../core/errors.js";
import type { RunningSession } from "./session.js";
import type { OwnedEntry, StateFile } from "./stateFile.js";

export type Owned = { session: RunningSession; cwd: string; model: string | null };

export type OwnedSet = {
  add(sessionId: string, entry: Owned): void;
  remove(sessionId: string): void;
  /** Moves an owned entry to the id its conversation continues under (after /clear). */
  rekey(previousId: string, newId: string): void;
  has(sessionId: string): boolean;
  require(sessionId: string): Owned;
  entries(): [string, Owned][];
  /** From now on the state file stays as it is: a daemon restart restores what was owned. */
  freeze(): void;
  persist(): void;
  persisted(): OwnedEntry[];
};

function requireEntry(owned: Map<string, Owned>, sessionId: string): Owned {
  const entry = owned.get(sessionId);
  if (entry === undefined) throw new FardeskError("not_found", `session ${sessionId} is not owned by fardeskd`);
  return entry;
}

function moveEntry(owned: Map<string, Owned>, previousId: string, newId: string): void {
  const entry = owned.get(previousId);
  if (entry === undefined) return;
  owned.set(newId, entry);
  owned.delete(previousId);
}

export function createOwnedSet(stateFile: StateFile): OwnedSet {
  const owned = new Map<string, Owned>();
  let frozen = false;
  const persist = (): void => {
    if (frozen) return;
    stateFile.write([...owned].map(([sessionId, entry]) => ({ sessionId, cwd: entry.cwd, model: entry.model })));
  };
  return {
    add(sessionId, entry): void {
      owned.set(sessionId, entry);
      persist();
    },
    remove(sessionId): void {
      owned.delete(sessionId);
      persist();
    },
    rekey(previousId, newId): void {
      moveEntry(owned, previousId, newId);
      persist();
    },
    has: (sessionId): boolean => owned.has(sessionId),
    require: (sessionId): Owned => requireEntry(owned, sessionId),
    entries: (): [string, Owned][] => [...owned],
    freeze(): void {
      frozen = true;
    },
    persist,
    persisted: (): OwnedEntry[] => stateFile.read(),
  };
}
