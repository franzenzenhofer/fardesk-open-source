// install-hooks, uninstall-hooks and the hook install state shown by `status`.
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { FardeskError } from "../core/errors.js";
import { buildHookEntries, HOOK_MARKER } from "../hooks/command.js";
import { installHooks, uninstallHooks } from "../hooks/installer.js";
import type { InstallResult } from "../hooks/installer.js";
import { previewInstall } from "../hooks/preview.js";
import { HOOK_SOCKET_FILE } from "../service/core.js";
import { EXIT_OK } from "./types.js";
import type { CommandContext } from "./types.js";

const SETTINGS_FILE = "settings.json";
export const settingsPathOf = (home: string): string => join(home, SETTINGS_FILE);

export const settingsPathsOf = (config: Config): string[] => config.claudeHomes.map(settingsPathOf);

export function describeResult(path: string, result: InstallResult): string {
  if (!result.changed) return `${path}: unchanged`;
  const backup = result.backupPath === null ? "no backup (new file)" : `backup ${result.backupPath}`;
  return `${path}: changed ${result.events.join(", ")}; ${backup}`;
}

const GROUP_OR_WORLD = 0o077;

/** The hook socket lives in the state dir: refuse to wire hooks to a folder other users can read. */
export function requirePrivateStateDir(stateDir: string): void {
  const stats = statSync(stateDir, { throwIfNoEntry: false });
  if (stats === undefined || (stats.mode & GROUP_OR_WORLD) === 0) return;
  const mode = (stats.mode & 0o777).toString(8);
  throw new FardeskError("invalid_request", `state dir ${stateDir} has mode ${mode}, readable by group or others: run chmod 700 ${stateDir} first`);
}

export const hookEntriesOf = (config: Config): ReturnType<typeof buildHookEntries> =>
  buildHookEntries({ socketPath: join(config.stateDir, HOOK_SOCKET_FILE), permissionTimeoutSeconds: config.permissionTimeoutSeconds });

function printDryRun(context: CommandContext, config: Config, entries: ReturnType<typeof buildHookEntries>): number {
  for (const path of settingsPathsOf(config)) {
    const diff = previewInstall(path, entries);
    context.io.stdout(diff.length === 0 ? `${path}: dry run, no change` : `${path}: dry run, install-hooks would change:`);
    for (const line of diff) context.io.stdout(line);
  }
  return EXIT_OK;
}

export function runHooksCommand(context: CommandContext, action: "install" | "uninstall"): number {
  if (context.dryRun && action === "uninstall") throw new FardeskError("invalid_request", "--dry-run is only for install-hooks");
  const config = loadConfig(context.configPath);
  if (action === "install") requirePrivateStateDir(config.stateDir);
  const now = context.now();
  const entries = hookEntriesOf(config);
  if (context.dryRun) return printDryRun(context, config, entries);
  for (const path of settingsPathsOf(config)) {
    const result = action === "install" ? installHooks(path, entries, now) : uninstallHooks(path, now);
    context.io.stdout(describeResult(path, result));
  }
  return EXIT_OK;
}

export type HookState = "installed" | "partial" | "not installed" | "no settings file" | `unreadable (${string})`;

function missingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export function hookStateOf(settingsPath: string, config: Config): HookState {
  const wanted = Object.keys(buildHookEntries({ socketPath: "unused", permissionTimeoutSeconds: config.permissionTimeoutSeconds }));
  try {
    const hooks = (JSON.parse(readFileSync(settingsPath, "utf8")) as { hooks?: Record<string, unknown> }).hooks ?? {};
    const present = wanted.filter((event) => JSON.stringify(hooks[event] ?? null).includes(HOOK_MARKER));
    if (present.length === wanted.length) return "installed";
    return present.length === 0 ? "not installed" : "partial";
  } catch (error) {
    return missingFile(error) ? "no settings file" : `unreadable (${(error as Error).message})`;
  }
}
