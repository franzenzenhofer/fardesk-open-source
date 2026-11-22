// Real release packages and a real (small shell script) installer for the self-update tests.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { InstallerFactory } from "../../src/update/installer.js";
import { sha256Hex } from "../../src/update/ownPackage.js";
import { makeTempDir, waitUntil } from "./env.js";

export type Release = { bytes: Buffer<ArrayBuffer>; sha256: string; version: string };

/** A tarball laid out like the one deploy.sh builds: package.json, install-local.sh and dist/main.js at its root. */
export function makeRelease(version: string, installScript = "#!/bin/sh\n"): Release {
  const dir = makeTempDir("fdrel-");
  mkdirSync(join(dir, "src", "dist"), { recursive: true });
  writeFileSync(join(dir, "src", "package.json"), JSON.stringify({ name: "fardeskd", version }));
  writeFileSync(join(dir, "src", "install-local.sh"), installScript);
  writeFileSync(join(dir, "src", "dist", "main.js"), "");
  const tarball = join(dir, "release.tgz");
  execFileSync("tar", ["-czf", tarball, "-C", join(dir, "src"), "."]);
  const bytes = readFileSync(tarball);
  return { bytes, sha256: sha256Hex(bytes), version };
}

/** An install folder that holds `release` as release.tgz, like a machine installed by deploy.sh. */
export function installDirWith(release: Release | null): string {
  const dir = makeTempDir("fdinst-");
  if (release !== null) writeFileSync(join(dir, "release.tgz"), release.bytes);
  return dir;
}

export type ScriptInstaller = {
  installer: InstallerFactory;
  /** The unpacked package folder the script was started with, once it ran. */
  ran(): Promise<{ packageDir: string; packageVersion: string }>;
};

/** The installer is `sh script.sh <package dir> <marker> <exit code> <output line>`: it records what it got, prints a line, exits. */
export function scriptInstaller(exitCode: number, outputLine: string): ScriptInstaller {
  const dir = makeTempDir("fdscript-");
  const script = join(dir, "install.sh");
  const marker = join(dir, "marker");
  writeFileSync(script, ['#!/bin/sh', 'printf "%s" "$1" > "$2"', 'grep -o \'"version":"[^"]*"\' "$1/package.json" > "$2.version"', '[ -n "$4" ] && echo "$4"', 'exit "$3"', ""].join("\n"));
  return {
    installer: (job) => ({ command: "sh", args: [script, job.packageDir, marker, String(exitCode), outputLine] }),
    async ran(): Promise<{ packageDir: string; packageVersion: string }> {
      await waitUntil(() => existsSync(`${marker}.version`) && readFileSync(`${marker}.version`, "utf8") !== "");
      const packageVersion = /"version":"([^"]*)"/.exec(readFileSync(`${marker}.version`, "utf8"))?.[1] ?? "";
      return { packageDir: readFileSync(marker, "utf8"), packageVersion };
    },
  };
}
