// discoverClaudeHomes: every Claude home on this machine, found on disk and in running `claude` processes.
import { readdirSync, realpathSync, statSync } from "node:fs";
import type { Dirent } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { RunCommand } from "../config/bind.js";
import { CLAUDE_CONFIG_ENV } from "../owned/claudeEnv.js";

export type HomeSource = "folder" | "process";
export type FoundHome = { path: string; sources: HomeSource[] };
/** `home`: the folder scanned one level deep, or null for no folder scan at all (there is no default home). */
export type DiscoverDeps = { home: string | null; run: RunCommand };

const REGISTRY_FILE = /^\d+\.json$/;
const TRANSCRIPT_FILE = /\.jsonl$/;
const PS_ARGS = ["eww", "-o", "pid=,command="];
/** Process names only (no environments, no arguments): safe even when some process cannot be read. */
const PS_LIST_ARGS = ["-x", "-o", "pid=,comm="];

function claudePids(listing: string): string[] {
  return listing.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(.+)$/.exec(line);
    return match?.[1] !== undefined && match[2] !== undefined && basename(match[2].trim()) === CLAUDE_EXECUTABLE ? [match[1]] : [];
  });
}
const CONFIG_DIR_IN_ENV = new RegExp(`(?:^|\\s)${CLAUDE_CONFIG_ENV}=(\\S+)`);
const CLAUDE_EXECUTABLE = "claude";

function entriesOf(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const hasRegistry = (dir: string): boolean => entriesOf(join(dir, "sessions")).some((entry) => entry.isFile() && REGISTRY_FILE.test(entry.name));

function hasTranscript(dir: string): boolean {
  const projects = join(dir, "projects");
  return entriesOf(projects).some((project) => project.isDirectory() && entriesOf(join(projects, project.name)).some((file) => TRANSCRIPT_FILE.test(file.name)));
}

/** The Claude Code layout: sessions/<pid>.json registry files or projects/<folder>/<id>.jsonl transcripts. A folder with just a similar name is not one. */
export const hasClaudeLayout = (dir: string): boolean => hasRegistry(dir) || hasTranscript(dir);

const isDirectory = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;

/** A symlink to a folder counts as a folder: `statSync` follows it, a Dirent does not. */
function foldersWithLayout(home: string): string[] {
  return entriesOf(home)
    .map((entry) => join(home, entry.name))
    .filter(isDirectory)
    .filter(hasClaudeLayout);
}

/** The canonical form used to compare homes; a path that does not exist compares as itself. */
export function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function isClaudeCommand(command: string): boolean {
  const executable = command.trim().split(/\s+/)[0] ?? "";
  return basename(executable) === CLAUDE_EXECUTABLE;
}

/**
 * The CLAUDE_CONFIG_DIR of every running `claude` process of this user. `ps eww` appends the environment to the
 * command line on macOS and Linux; a value that contains spaces is cut at the first space and then fails the
 * folder check by the caller. A machine where `ps` cannot be run contributes nothing.
 */
export async function configDirsOfRunningClaude(run: RunCommand): Promise<string[]> {
  let output: string;
  try {
    // Environments are read only for claude processes: reading every process's environment hangs on any process
    // that is stuck in uninterruptible sleep (2026-11-21: browser helpers), and other programs' environments are
    // none of our business.
    const pids = claudePids(await run("ps", PS_LIST_ARGS));
    if (pids.length === 0) return [];
    output = await run("ps", [...PS_ARGS, "-p", pids.join(",")]);
  } catch {
    return [];
  }
  const dirs = output.split("\n").flatMap((line) => {
    const command = line.trim().replace(/^\d+\s+/, "");
    const value = isClaudeCommand(command) ? CONFIG_DIR_IN_ENV.exec(command)?.[1] : undefined;
    return value === undefined ? [] : [resolve(value)];
  });
  return [...new Set(dirs)];
}

/** Homes are keyed by their real path, so a symlink and its target are one home; the path shown is the first one seen. */
function merge(found: Map<string, FoundHome>, path: string, source: HomeSource): void {
  const key = canonicalPath(path);
  const existing = found.get(key);
  if (existing === undefined) found.set(key, { path, sources: [source] });
  else if (!existing.sources.includes(source)) existing.sources.push(source);
}

/** Without a `home` (null) only the running processes are looked at: the folder scan never guesses a home folder. */
export async function discoverClaudeHomes(deps: DiscoverDeps): Promise<FoundHome[]> {
  const found = new Map<string, FoundHome>();
  if (deps.home !== null) for (const path of foldersWithLayout(deps.home)) merge(found, path, "folder");
  for (const path of await configDirsOfRunningClaude(deps.run)) if (isDirectory(path)) merge(found, path, "process");
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}
