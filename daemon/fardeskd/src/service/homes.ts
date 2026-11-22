// Reload the Claude homes of the running daemon from its config file, without a restart.
import { homePaths } from "../config/claudeHomes.js";
import { loadConfig } from "../config/config.js";
import type { Config } from "../config/config.js";
import { FardeskError } from "../core/errors.js";
import type { SessionStore } from "../sessions/store.js";

/**
 * The list is replaced in place, so everything that reads `config.claudeHomes` on each use (the store poll, the actions)
 * sees the new homes at its next read, the owned runner included (it resolves a home name on every start). A config
 * file that lists no home is refused.
 */
export function reloadHomes(config: Config, configPath: string, store: SessionStore): { homes: string[] } {
  const next = loadConfig(configPath).claudeHomes;
  if (next.length === 0) throw new FardeskError("invalid_request", `${configPath} lists no claudeHomes: the daemon keeps its current homes`);
  config.claudeHomes.splice(0, config.claudeHomes.length, ...next);
  store.refresh();
  return { homes: homePaths(config.claudeHomes) };
}
