// A session in a plain terminal tab: the tab is `terminal app -> login shell -> claude`. Closing the tab = ending that shell.
import { ancestry, commandName } from "./processTree.js";
import type { ProcessInfo, ProcessTable } from "./processTree.js";

const SHELLS: ReadonlySet<string> = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu"]);
const TERMINAL_APPS: ReadonlySet<string> = new Set(["ghostty", "terminal", "iterm2", "wezterm-gui", "wezterm", "kitty", "alacritty", "login"]);

/**
 * The shell that is the direct parent of `pid` when that shell's own parent is a terminal app; null otherwise.
 * Only ever the parent of the session's process, never anything else.
 */
export function findTabShell(table: ProcessTable, pid: number): ProcessInfo | null {
  const [, shell, terminal] = ancestry(table, pid);
  if (shell === undefined || terminal === undefined) return null;
  return SHELLS.has(commandName(shell)) && TERMINAL_APPS.has(commandName(terminal)) ? shell : null;
}
