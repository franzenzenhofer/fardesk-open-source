// Unpacks a posted release package and runs its installer in the background, detached from the daemon.
// The installer restarts the service (launchctl bootout/bootstrap, systemctl --user restart), which ends this process:
// the installer must outlive it (new session via `detached`; plist AbandonProcessGroup and unit KillMode=process).
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { runCommand, spawnDetached } from "../config/bind.js";
import { join } from "node:path";
import { z } from "zod";
import { FardeskError } from "../core/errors.js";
import type { UpdatePaths } from "./paths.js";

const packageJsonSchema = z.looseObject({ name: z.literal("fardeskd"), version: z.string().min(1) });
const INSTALL_SCRIPT = "install-local.sh";
const EXIT_FILE_ENV = "FARDESK_UPDATE_EXIT_FILE";
// Runs the installer command and records its exit code, so the next daemon process can say whether it worked.
const RECORD_EXIT = `"$@"; code=$?; echo "$code" > "$${EXIT_FILE_ENV}"; exit "$code"`;
// Same steps as deploy/deploy.sh: unpack over the install folder, keep the package as release.tgz, run install-local.sh there.
const INSTALL_STEPS = 'cp -R "$1/." "$2/" && cp "$3" "$2/release.tgz" && bash "$2/install-local.sh" "$4"';

export type InstallJob = { packagePath: string; packageDir: string; installDir: string; machineName: string };
export type InstallCommand = { command: string; args: string[]; env?: Record<string, string> };
/** Builds the command that installs `job`. Injectable: tests run a small real shell script instead of the real installer. */
export type InstallerFactory = (job: InstallJob) => InstallCommand;

export const releaseInstaller: InstallerFactory = (job) => {
  const label = process.env["FARDESK_LABEL"];
  if (label === undefined || label === "") {
    throw new FardeskError("unsupported", "this install does not know its service label: install once with deploy/deploy.sh, then it can update itself");
  }
  return { command: "/bin/sh", args: ["-c", INSTALL_STEPS, "fardesk-install", job.packageDir, job.installDir, job.packagePath, job.machineName], env: { FARDESK_LABEL: label } };
};

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Unpacks the staged package and returns its version (package.json). Anything that is not a Fardesk release is `invalid_request`. */
export async function unpackRelease(paths: UpdatePaths): Promise<string> {
  rmSync(paths.unpackedDir, { recursive: true, force: true });
  mkdirSync(paths.unpackedDir, { recursive: true, mode: 0o700 });
  try {
    await runCommand("tar", ["-xzf", paths.stagedPackage, "-C", paths.unpackedDir]);
  } catch {
    throw new FardeskError("invalid_request", "the body is not a release package (a .tgz that tar can unpack)");
  }
  const manifest = join(paths.unpackedDir, "package.json");
  if (!existsSync(manifest) || !existsSync(join(paths.unpackedDir, INSTALL_SCRIPT))) {
    throw new FardeskError("invalid_request", `the release package has no package.json and ${INSTALL_SCRIPT}`);
  }
  const parsed = packageJsonSchema.safeParse(parseJson(readFileSync(manifest, "utf8")));
  if (!parsed.success) throw new FardeskError("invalid_request", "the release package is not a fardeskd release (package.json name and version)");
  return parsed.data.version;
}

/** Starts the installer detached with its output in the log file. `onError`: the process could not be started at all. */
export function startInstaller(install: InstallCommand, paths: UpdatePaths, onError: (error: Error) => void): void {
  spawnDetached({
    command: "/bin/sh",
    args: ["-c", RECORD_EXIT, "fardesk-update", install.command, ...install.args],
    env: { ...process.env, ...install.env, [EXIT_FILE_ENV]: paths.exitFile },
    logPath: paths.logFile,
    onError,
  });
}
