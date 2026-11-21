// A real `tailscale` executable in a temp dir: fails N times, then reports Running with the address in <dir>/address
// (no address file = Stopped). Put `dir` first on PATH to make the daemon find it like the real one.
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { makeTempDir } from "./env.js";

const SCRIPT = [
  "#!/bin/sh",
  'dir="$(dirname "$0")"',
  'if [ "$1" = "status" ]; then',
  '  left=$(cat "$dir/failures-left" 2>/dev/null || echo 0)',
  '  if [ "$left" -gt 0 ]; then echo $((left - 1)) > "$dir/failures-left"; echo "failed to connect to local tailscaled" >&2; exit 1; fi',
  '  if [ ! -f "$dir/address" ]; then echo \'{"BackendState":"Stopped"}\'; exit 0; fi',
  '  echo \'{"BackendState":"Running"}\'; exit 0',
  "fi",
  'if [ "$1" = "ip" ]; then cat "$dir/address"; exit 0; fi',
  "exit 2",
  "",
].join("\n");

export type FakeTailscale = {
  dir: string;
  /** The next `count` calls of `status` fail like an unreachable daemon. */
  failNext(count: number): void;
  /** The tailnet address now reported; null = Tailscale reports Stopped. */
  setAddress(address: string | null): void;
};

/** Makes `tailscale` on PATH this fake for the current test (undo with vi.unstubAllEnvs). */
export function putOnPath(fake: FakeTailscale): void {
  vi.stubEnv("PATH", `${fake.dir}:${process.env["PATH"] ?? ""}`);
}

export function createFakeTailscale(address: string | null): FakeTailscale {
  const dir = makeTempDir("fdt-");
  writeFileSync(join(dir, "tailscale"), SCRIPT);
  chmodSync(join(dir, "tailscale"), 0o755);
  const fake: FakeTailscale = {
    dir,
    failNext: (count) => {
      writeFileSync(join(dir, "failures-left"), `${count}\n`);
    },
    setAddress: (next) => {
      if (next === null) rmSync(join(dir, "address"), { force: true });
      else writeFileSync(join(dir, "address"), `${next}\n`);
    },
  };
  fake.setAddress(address);
  return fake;
}
