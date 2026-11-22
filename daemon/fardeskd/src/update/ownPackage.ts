// The release package this machine was installed from (<install dir>/release.tgz): served to others, hashed for /v1/machine.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { FardeskError } from "../core/errors.js";
import { RELEASE_PACKAGE_FILE } from "./paths.js";

export type OwnPackage = {
  /** SHA-256 (hex) of the installed package, null when this install has none. */
  sha256(): string | null;
  /** The package bytes; `not_found` when this install has none. */
  read(): Buffer<ArrayBuffer>;
};

export const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

export function createOwnPackage(installDir: string): OwnPackage {
  const file = join(installDir, RELEASE_PACKAGE_FILE);
  let cached: { stamp: string; sha: string } | null = null;
  return {
    sha256(): string | null {
      if (!existsSync(file)) return null;
      const { mtimeMs, size } = statSync(file);
      const stamp = `${mtimeMs}:${size}`;
      if (cached?.stamp !== stamp) cached = { stamp, sha: sha256Hex(readFileSync(file)) };
      return cached.sha;
    },
    read(): Buffer<ArrayBuffer> {
      if (!existsSync(file)) throw new FardeskError("not_found", "this machine has no release package: it was not installed with deploy.sh or an update");
      return readFileSync(file);
    },
  };
}
