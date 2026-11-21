// Sessions whose working folder is in the system temp folder are automation (test runs, scripts): they never
// enter the session store, so they are not listed, streamed or pushed. Tests of real claude start and end such
// sessions by the hundred and move their folders to the trash afterwards.
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, relative, resolve } from "node:path";
import { isUnder } from "./visible.js";

/** Test override: the automation roots as a path-delimiter separated list; the default is the real temp folders. */
export const AUTOMATION_ROOTS_ENV = "FARDESK_AUTOMATION_ROOTS";

const SYSTEM_TEMP_ROOTS = ["/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

/** The path with symlinks resolved as far as it exists (a trashed folder no longer exists, its parents do). */
function canonical(path: string): string {
  const absolute = resolve(path);
  for (let probe = absolute; ; probe = dirname(probe)) {
    try {
      return join(realpathSync(probe), relative(probe, absolute));
    } catch {
      if (dirname(probe) === probe) return absolute;
    }
  }
}

type Roots = { raw: string; paths: string[]; encoded: string[] };

// Claude names a project folder after the working folder with every non-alphanumeric character replaced by "-".
const encodeProjectDir = (path: string): string => path.replace(/[^A-Za-z0-9]/g, "-");

let cached: Roots | null = null;

function roots(): Roots {
  const override = process.env[AUTOMATION_ROOTS_ENV];
  const raw = override ?? "default roots";
  if (cached?.raw === raw) return cached;
  const listed = override === undefined ? [...SYSTEM_TEMP_ROOTS, tmpdir()] : override.split(delimiter).filter((root) => root !== "");
  const paths = [...new Set(listed.flatMap((root) => [resolve(root), canonical(root)]))];
  cached = { raw, paths, encoded: paths.map(encodeProjectDir) };
  return cached;
}

export function isAutomationCwd(cwd: string): boolean {
  const candidates = [resolve(cwd), canonical(cwd)];
  return roots().paths.some((root) => candidates.some((candidate) => isUnder(candidate, root)));
}

/** A transcript's project folder name (`-private-var-folders-...`) tells its working folder without reading the file. */
export function isAutomationProjectDir(projectDir: string): boolean {
  const name = basename(projectDir);
  return roots().encoded.some((root) => name === root || name.startsWith(`${root}-`));
}
