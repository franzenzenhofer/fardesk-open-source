// `fardeskd cross-session <accept|unset>`: sets or removes `crossSessionInbound` in every Claude home's settings.json.
import { loadConfig } from "../config/config.js";
import { rewriteSettings } from "../hooks/installer.js";
import { CROSS_SESSION_ACCEPT, CROSS_SESSION_KEY } from "../sessions/crossSession.js";
import { settingsPathsOf } from "./hooks.js";
import { EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CommandContext } from "./types.js";

const ACTIONS = ["accept", "unset"] as const;

export function runCrossSession(context: CommandContext): number {
  const action = ACTIONS.find((candidate) => candidate === context.target);
  if (action === undefined) {
    context.io.stderr("cross-session needs one argument: accept or unset");
    return EXIT_USAGE;
  }
  const config = loadConfig(context.configPath);
  for (const path of settingsPathsOf(config)) {
    const result = rewriteSettings(
      path,
      (settings) => {
        const rest = Object.fromEntries(Object.entries(settings).filter(([key]) => key !== CROSS_SESSION_KEY));
        return action === "accept" ? { ...rest, [CROSS_SESSION_KEY]: CROSS_SESSION_ACCEPT } : rest;
      },
      context.now(),
    );
    const backup = result.backupPath === null ? "no backup" : `backup ${result.backupPath}`;
    context.io.stdout(`${path}: ${CROSS_SESSION_KEY} ${result.changed ? `changed (${action}); ${backup}` : "unchanged"}`);
  }
  return EXIT_OK;
}
