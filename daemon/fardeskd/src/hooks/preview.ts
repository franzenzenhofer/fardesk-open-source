// `install-hooks --dry-run`: what installing would change in a settings.json, as a line diff. Writes nothing.
import { readSettings, applyInstall, serialise } from "./installer.js";
import type { HookEntries } from "./command.js";

const CONTEXT_LINES = 2;

/** Lines removed and added between two texts, trimmed to the changed middle plus a little context. */
export function lineDiff(before: string, after: string): string[] {
  const old = before.split("\n");
  const next = after.split("\n");
  let start = 0;
  while (start < old.length && start < next.length && old[start] === next[start]) start += 1;
  let oldEnd = old.length;
  let nextEnd = next.length;
  while (oldEnd > start && nextEnd > start && old[oldEnd - 1] === next[nextEnd - 1]) {
    oldEnd -= 1;
    nextEnd -= 1;
  }
  if (start === oldEnd && start === nextEnd) return [];
  const lead = old.slice(Math.max(0, start - CONTEXT_LINES), start).map((line) => `  ${line}`);
  const trail = old.slice(oldEnd, oldEnd + CONTEXT_LINES).map((line) => `  ${line}`);
  return [...lead, ...old.slice(start, oldEnd).map((line) => `- ${line}`), ...next.slice(start, nextEnd).map((line) => `+ ${line}`), ...trail];
}

/** The diff of the settings file as `install-hooks` would rewrite it (empty when nothing changes). */
export function previewInstall(settingsPath: string, entries: HookEntries): string[] {
  const before = readSettings(settingsPath) ?? {};
  return lineDiff(serialise(before), serialise(applyInstall(settingsPath, before, entries)));
}
