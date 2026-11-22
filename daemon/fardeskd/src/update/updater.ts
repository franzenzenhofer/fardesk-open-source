// Self-update of this machine: serve the installed release package, take a new one, install it in the background.
import { mkdirSync, writeFileSync } from "node:fs";
import type { UpdateStatus } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { releaseInstaller, startInstaller, unpackRelease } from "./installer.js";
import type { InstallerFactory } from "./installer.js";
import { createOwnPackage, sha256Hex } from "./ownPackage.js";
import { INSTALL_DIR, updatePaths } from "./paths.js";
import { createTracker, DEFAULT_STALE_MS } from "./tracker.js";

export const MAX_UPDATE_PACKAGE_BYTES = 20_000_000;

export type UpdaterOptions = {
  stateDir: string;
  machineName: string;
  /** This daemon's own version: a running update to exactly this version is done once a daemon of it starts. */
  ownVersion: string;
  /** The folder this daemon is installed in (default: the parent of its dist/). */
  installDir?: string;
  installer?: InstallerFactory;
  now?: () => Date;
  staleMs?: number;
};

export type Updater = {
  status(): UpdateStatus;
  /** The installed release package; `not_found` when this install has none. */
  readPackage(): Buffer<ArrayBuffer>;
  /** Checks the hash, unpacks, marks the update running and starts the installer. Returns at once. */
  start(bytes: Uint8Array, sha256: string): Promise<void>;
};

export function createUpdater(options: UpdaterOptions): Updater {
  const paths = updatePaths(options.stateDir);
  const installDir = options.installDir ?? INSTALL_DIR;
  const installer = options.installer ?? releaseInstaller;
  const own = createOwnPackage(installDir);
  const tracker = createTracker({ paths, ownVersion: options.ownVersion, now: options.now ?? ((): Date => new Date()), staleMs: options.staleMs ?? DEFAULT_STALE_MS });
  return {
    status: () => ({ ...tracker.current(), packageSha256: own.sha256() }),
    readPackage: () => own.read(),
    async start(bytes, sha256): Promise<void> {
      if (tracker.current().state === "running") throw new FardeskError("conflict", "an update is already running on this machine");
      if (sha256Hex(bytes) !== sha256.toLowerCase()) throw new FardeskError("invalid_request", "the package does not match its X-Fardesk-Package-Sha256 header");
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      writeFileSync(paths.stagedPackage, bytes, { mode: 0o600 });
      const version = await unpackRelease(paths);
      const install = installer({ packagePath: paths.stagedPackage, packageDir: paths.unpackedDir, installDir, machineName: options.machineName });
      tracker.begin(version);
      startInstaller(install, paths, (error) => { tracker.fail(`the installer could not start: ${error.message}`); });
    },
  };
}
