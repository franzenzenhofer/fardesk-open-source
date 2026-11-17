// Which sessions clients (app, CLI, hub) see: every live session, plus only the newest ended ones of the
// last weeks. On 2026-11-16 the three machines reported 436 sessions, 415 of them ended and 269 from test
// folders; each hub probe re-sent that whole list to the phone. The coordinator still reads the full store.
import { existsSync } from "node:fs";
import { sep } from "node:path";
import type { SessionSummary } from "../contract/schema.js";

const DAY_MS = 86_400_000;

/**
 * endedWithinDays / maxEnded: the window and cap for ended sessions. hiddenRoots: folders whose ended sessions
 * are clutter (the OS temp dirs test runs use, the coordinator's own folder: its old sessions are not projects).
 */
export type ListRules = {
  now: number;
  endedWithinDays: number;
  maxEnded: number;
  hiddenRoots: readonly string[];
  /** Defaults to the real file system; a parameter so a test can count the lookups. */
  folderExists?: (path: string) => boolean;
};

export const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`);

function worthListing(session: SessionSummary, rules: ListRules): boolean {
  if (rules.hiddenRoots.some((root) => isUnder(session.cwd, root))) return false;
  if (rules.now - Date.parse(session.updatedAt) > rules.endedWithinDays * DAY_MS) return false;
  return (rules.folderExists ?? existsSync)(session.cwd);
}

export function visibleSessions(sessions: SessionSummary[], rules: ListRules): SessionSummary[] {
  const newestEnded = sessions.filter((session) => session.status === "ended").toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const kept = new Set<string>();
  for (const session of newestEnded) {
    if (kept.size >= rules.maxEnded) break;
    if (worthListing(session, rules)) kept.add(session.id);
  }
  return sessions.filter((session) => session.status !== "ended" || kept.has(session.id));
}
