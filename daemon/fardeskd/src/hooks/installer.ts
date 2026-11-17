import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { FardeskError } from "../core/errors.js";
import { HOOK_MARKER } from "./command.js";
import type { HookEntries } from "./command.js";

const NEW_FILE_MODE = 0o600;
const MODE_MASK = 0o777;
const DIR_MODE = 0o700;
const INDENT = 2;

export type InstallResult = { changed: boolean; backupPath: string | null; events: string[] };

export type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOurs(hook: unknown): boolean {
  return isRecord(hook) && typeof hook["command"] === "string" && hook["command"].includes(HOOK_MARKER);
}

function invalid(path: string, why: string): FardeskError {
  return new FardeskError("invalid_request", `settings file ${path}: ${why}`);
}

export function readSettings(path: string): Json | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw invalid(path, `not valid JSON (${(error as Error).message})`);
  }
  if (!isRecord(parsed)) throw invalid(path, "top level is not an object");
  if ("hooks" in parsed && !isRecord(parsed["hooks"])) throw invalid(path, "`hooks` is not an object");
  return parsed;
}

// Removes our hooks from every group of one event; drops groups that become empty.
function stripOurs(path: string, event: string, groups: unknown): unknown[] {
  if (!Array.isArray(groups)) throw invalid(path, `hooks.${event} is not an array`);
  const kept: unknown[] = [];
  for (const group of groups as unknown[]) {
    const inner = isRecord(group) ? group["hooks"] : undefined;
    if (!isRecord(group) || !Array.isArray(inner) || !inner.some(isOurs)) {
      kept.push(group);
      continue;
    }
    const rest = inner.filter((hook) => !isOurs(hook));
    if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  return kept;
}

export function applyInstall(path: string, settings: Json, entries: HookEntries): Json {
  const hooks: Json = isRecord(settings["hooks"]) ? { ...settings["hooks"] } : {};
  for (const [event, groups] of Object.entries(entries)) {
    hooks[event] = [...stripOurs(path, event, hooks[event] ?? []), ...groups];
  }
  return { ...settings, hooks };
}

function applyUninstall(path: string, settings: Json): Json {
  if (!isRecord(settings["hooks"])) return settings;
  const hooks: Json = {};
  for (const [event, groups] of Object.entries(settings["hooks"])) {
    const kept = stripOurs(path, event, groups);
    if (kept.length > 0) hooks[event] = kept;
  }
  const next = { ...settings };
  if (Object.keys(hooks).length > 0) next["hooks"] = hooks;
  else delete next["hooks"];
  return next;
}

export function serialise(settings: Json): string {
  return `${JSON.stringify(settings, null, INDENT)}\n`;
}

function stamp(now: Date): string {
  return now
    .toISOString()
    .replace(/\.\d+Z$/, "")
    .replaceAll("-", "")
    .replaceAll(":", "")
    .replace("T", "-");
}

function atomicWrite(path: string, content: string, mode: number): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const temp = `${path}.fardesk-tmp-${process.pid}`;
  writeFileSync(temp, content, { mode });
  chmodSync(temp, mode);
  renameSync(temp, path);
}

function hooksOf(settings: Json): Json {
  return isRecord(settings["hooks"]) ? settings["hooks"] : {};
}

function changedEvents(before: Json, after: Json): string[] {
  const old = hooksOf(before);
  const next = hooksOf(after);
  const names = new Set([...Object.keys(old), ...Object.keys(next)]);
  return [...names].filter((event) => JSON.stringify(old[event]) !== JSON.stringify(next[event])).sort();
}

function commit(path: string, before: Json | null, after: Json, now: Date): InstallResult {
  if (before !== null && serialise(before) === serialise(after)) return { changed: false, backupPath: null, events: [] };
  const events = changedEvents(before ?? {}, after);
  if (before === null) {
    atomicWrite(path, serialise(after), NEW_FILE_MODE);
    return { changed: true, backupPath: null, events };
  }
  const backupPath = `${path}.fardesk-bak-${stamp(now)}`;
  copyFileSync(path, backupPath);
  atomicWrite(path, serialise(after), statSync(path).mode & MODE_MASK);
  return { changed: true, backupPath, events };
}

export function rewriteSettings(settingsPath: string, transform: (settings: Json) => Json, now: Date): InstallResult {
  const before = readSettings(settingsPath);
  return commit(settingsPath, before, transform(before ?? {}), now);
}

export function installHooks(settingsPath: string, entries: HookEntries, now: Date): InstallResult {
  const before = readSettings(settingsPath);
  return commit(settingsPath, before, applyInstall(settingsPath, before ?? {}, entries), now);
}

export function uninstallHooks(settingsPath: string, now: Date): InstallResult {
  const before = readSettings(settingsPath);
  if (before === null) return { changed: false, backupPath: null, events: [] };
  return commit(settingsPath, before, applyUninstall(settingsPath, before), now);
}
