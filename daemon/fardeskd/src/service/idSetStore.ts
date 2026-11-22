// A persisted set of session ids (muted ones, hidden ones) in a strict JSON state file `{ "<key>": [ids...] }`.
import { z } from "zod";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

export type IdSetStore = {
  has(sessionId: string): boolean;
  ids(): ReadonlySet<string>;
  set(sessionId: string, member: boolean): void;
};

export function createIdSetStore(path: string, key: string, what: string): IdSetStore {
  const fileSchema = z.strictObject({ [key]: z.array(z.string().min(1)) });
  const read = (): Set<string> => new Set(readJsonState(path, fileSchema, what, { [key]: [] })[key] ?? []);
  let members = read();
  return {
    has: (sessionId): boolean => members.has(sessionId),
    ids: (): ReadonlySet<string> => members,
    set(sessionId, member): void {
      if (members.has(sessionId) === member) return;
      const next = new Set(members);
      if (member) next.add(sessionId);
      else next.delete(sessionId);
      writeJsonState(path, { [key]: [...next].sort() });
      members = next;
    },
  };
}
