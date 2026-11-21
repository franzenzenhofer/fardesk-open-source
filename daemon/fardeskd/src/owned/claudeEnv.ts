import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Claude Code reads its home (sessions, transcripts, login) from this variable; unset means `~/.claude`. */
export const CLAUDE_CONFIG_ENV = "CLAUDE_CONFIG_DIR";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The environment for a `claude` process that must write into `claudeHome`.
 * The daemon reads transcripts and the process registry from `claudeHome`, so the child must not inherit
 * another home from the daemon's own environment. The default home is selected by leaving the variable
 * unset: setting it, even to `~/.claude`, makes Claude Code use a different login keychain entry.
 */
export function claudeHomeEnv(claudeHome: string, base: Env, home: string = homedir()): Record<string, string | undefined> {
  const inherited = Object.fromEntries(Object.entries(base).filter(([key]) => key !== CLAUDE_CONFIG_ENV));
  const target = resolve(claudeHome);
  return target === join(home, ".claude") ? inherited : { ...inherited, [CLAUDE_CONFIG_ENV]: target };
}
