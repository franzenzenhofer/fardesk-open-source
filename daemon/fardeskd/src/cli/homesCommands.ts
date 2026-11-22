// `fardeskd homes` (configured and found Claude homes), `fardeskd homes add <path>`, and the status lines for unconfigured homes.
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG_DEFAULTS, expandHome, loadConfig, readConfigFile, updateConfigFile } from "../config/config.js";
import type { Config } from "../config/config.js";
import { FardeskError } from "../core/errors.js";
import { z } from "zod";
import { homePaths } from "../config/claudeHomes.js";
import { canonicalPath, discoverClaudeHomes } from "../homes/discover.js";
import type { FoundHome } from "../homes/discover.js";
import { installHooks } from "../hooks/installer.js";
import { previewInstall } from "../hooks/preview.js";
import { callDaemon } from "./daemonClient.js";
import { describeResult, hookEntriesOf, hookStateOf, requirePrivateStateDir, settingsPathOf } from "./hooks.js";
import { EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CommandContext } from "./types.js";

const homesReloadSchema = z.strictObject({ homes: z.array(z.string()) });

const addCommand = (path: string): string => `fardeskd homes add ${path}`;

async function unconfigured(context: CommandContext, config: Config): Promise<FoundHome[]> {
  const configured = new Set(homePaths(config.claudeHomes).map(canonicalPath));
  const home = context.io.env["HOME"] ?? null;
  return (await discoverClaudeHomes({ run: context.run, home })).filter((found) => !configured.has(canonicalPath(found.path)));
}

const describeFound = (found: FoundHome): string =>
  `${found.path} (found by ${found.sources.map((source) => (source === "process" ? "a running claude process" : "its folder layout")).join(" and ")}): ${addCommand(found.path)}`;

/** One line per Claude home that exists on this machine but is not in claudeHomes, with the command that adds it. */
export async function printUnconfiguredHomes(context: CommandContext, config: Config): Promise<void> {
  for (const found of await unconfigured(context, config)) context.io.stdout(`claude home not configured, its sessions are invisible: ${describeFound(found)}`);
}

async function listHomes(context: CommandContext): Promise<number> {
  const config = loadConfig(context.configPath);
  for (const { path: home, name } of config.claudeHomes) context.io.stdout(`configured ${home} (named ${name}): hooks ${hookStateOf(settingsPathOf(home), config)}`);
  const missing = await unconfigured(context, config);
  for (const found of missing) context.io.stdout(`found, not configured ${describeFound(found)}`);
  if (missing.length === 0) context.io.stdout("no other Claude home found");
  return EXIT_OK;
}

function requireDirectory(path: string): void {
  if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) throw new FardeskError("invalid_request", `${path} is not a folder`);
}

function writeHome(configPath: string, path: string): void {
  const current = readConfigFile(configPath)["claudeHomes"];
  const homes: unknown[] = Array.isArray(current) ? current : CONFIG_DEFAULTS.claudeHomes;
  updateConfigFile(configPath, { claudeHomes: [...homes, path] });
}

async function addHome(context: CommandContext, raw: string): Promise<number> {
  const { io } = context;
  const path = resolve(expandHome(raw));
  const config = loadConfig(context.configPath);
  if (config.claudeHomes.some((home) => canonicalPath(home.path) === canonicalPath(path))) {
    io.stdout(`${path} is already in claudeHomes: nothing changed`);
    return EXIT_OK;
  }
  requireDirectory(path);
  requirePrivateStateDir(config.stateDir);
  const settings = settingsPathOf(path);
  const entries = hookEntriesOf(config);
  for (const line of previewInstall(settings, entries)) io.stdout(line);
  const previousConfig = readFileSync(context.configPath, "utf8");
  writeHome(context.configPath, path);
  try {
    io.stdout(describeResult(settings, installHooks(settings, entries, context.now())));
  } catch (error) {
    writeFileSync(context.configPath, previousConfig);
    throw new FardeskError("invalid_request", `could not install the hooks in ${settings}, ${context.configPath} is back to what it was: ${(error as Error).message}`);
  }
  io.stdout(`added ${path} to claudeHomes in ${context.configPath}`);
  const reloaded = await callDaemon(context, { method: "POST", path: "/v1/homes/reload" }, homesReloadSchema);
  io.stdout(reloaded.kind === "offline" ? `${reloaded.reason}: the next fardeskd start reads this home` : "the running daemon reloaded its homes: sessions in this home are listed now");
  return EXIT_OK;
}

export async function runHomes(context: CommandContext): Promise<number> {
  const [action, path] = context.args;
  if (action === undefined) return listHomes(context);
  if (action === "add" && path !== undefined && context.args.length === 2) return addHome(context, path);
  context.io.stderr("usage: fardeskd homes [add <path>]");
  return EXIT_USAGE;
}
