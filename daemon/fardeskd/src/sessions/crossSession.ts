// Claude Code's `crossSessionInbound` setting: bypass-mode sessions only read inbox messages when it is "accept".
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CROSS_SESSION_KEY = "crossSessionInbound";
export const CROSS_SESSION_ACCEPT = "accept";
const SETTINGS_FILE = "settings.json";

// Lenient on purpose: Claude Code owns this file; a missing, unreadable or odd file means "not accepted".
export function readCrossSessionInbound(claudeHome: string): string | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(claudeHome, SETTINGS_FILE), "utf8"));
    const value = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>)[CROSS_SESSION_KEY] : undefined;
    return typeof value === "string" ? value : null;
  } catch {
    return null;
  }
}

export const acceptsCrossSession = (claudeHome: string): boolean => readCrossSessionInbound(claudeHome) === CROSS_SESSION_ACCEPT;
