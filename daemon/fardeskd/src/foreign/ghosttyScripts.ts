// The AppleScripts the daemon runs against Ghostty (macOS). They are files run with `osascript <file> <args>`:
// user text and terminal ids arrive as argv items of `on run argv`, never inside script source, so nothing needs quoting.
// Written to <stateDir>/applescript/ at startup. Terminology: `sdef /Applications/Ghostty.app` (Ghostty 1.4.0).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SCRIPT_DIR = "applescript";

/** One line per terminal: id TAB tty TAB pid TAB working directory. Read-only. */
export const LIST_SCRIPT = `on run argv
  set fieldSeparator to tab
  set lineSeparator to linefeed
  set report to ""
  tell application "Ghostty"
    repeat with theTerminal in terminals
      set report to report & (id of theTerminal) & fieldSeparator & (tty of theTerminal) & fieldSeparator & (pid of theTerminal) & fieldSeparator & (working directory of theTerminal) & lineSeparator
    end repeat
  end tell
  return report
end run
`;

/** argv: text, terminal id. Types the text as a paste, then presses Enter. */
export const TYPE_SCRIPT = `on run argv
  set theText to item 1 of argv
  set terminalId to item 2 of argv
  tell application "Ghostty"
    set theTerminal to first terminal whose id is terminalId
    input text theText to theTerminal
    send key "enter" to theTerminal
  end tell
end run
`;

/** argv: terminal id. Closes the tab holding that terminal; when the tab has splits, only that terminal. */
export const CLOSE_SCRIPT = `on run argv
  set terminalId to item 1 of argv
  tell application "Ghostty"
    repeat with theWindow in windows
      repeat with theTab in tabs of theWindow
        set matching to (terminals of theTab whose id is terminalId)
        if (count of matching) > 0 then
          if (count of (terminals of theTab)) is 1 then
            close tab theTab
          else
            close (item 1 of matching)
          end if
          return
        end if
      end repeat
    end repeat
  end tell
  error "no Ghostty tab holds terminal " & terminalId
end run
`;

export const SCRIPTS = { list: LIST_SCRIPT, type: TYPE_SCRIPT, close: CLOSE_SCRIPT } as const;
export type ScriptName = keyof typeof SCRIPTS;

function sameContent(path: string, content: string): boolean {
  try {
    return readFileSync(path, "utf8") === content;
  } catch {
    return false;
  }
}

/** Writes the scripts under `<stateDir>/applescript/` (only when missing or changed) and returns their paths. */
export function installScripts(stateDir: string): Record<ScriptName, string> {
  const dir = join(stateDir, SCRIPT_DIR);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const paths = {} as Record<ScriptName, string>;
  for (const name of Object.keys(SCRIPTS) as ScriptName[]) {
    const path = join(dir, `ghostty-${name}.applescript`);
    if (!sameContent(path, SCRIPTS[name])) writeFileSync(path, SCRIPTS[name], { mode: 0o600 });
    paths[name] = path;
  }
  return paths;
}
