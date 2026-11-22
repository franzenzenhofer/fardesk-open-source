// Where a self-update keeps its files: under <stateDir>/update, plus the installed release package next to dist/.
import { join } from "node:path";

export const RELEASE_PACKAGE_FILE = "release.tgz";
/** The install folder is the parent of dist/: this file sits in dist/update/ (and in src/update/ under test). */
export const INSTALL_DIR = new URL("../../", import.meta.url).pathname;

export type UpdatePaths = {
  dir: string;
  stateFile: string;
  /** Written by the installer wrapper when the installer ends: its exit code as text. */
  exitFile: string;
  logFile: string;
  /** The package that was posted, as received. */
  stagedPackage: string;
  /** The same package, unpacked: this is what the installer gets. */
  unpackedDir: string;
};

export function updatePaths(stateDir: string): UpdatePaths {
  const dir = join(stateDir, "update");
  return {
    dir,
    stateFile: join(dir, "state.json"),
    exitFile: join(dir, "installer-exit-code"),
    logFile: join(dir, "installer.log"),
    stagedPackage: join(dir, "staged-release.tgz"),
    unpackedDir: join(dir, "unpacked"),
  };
}
