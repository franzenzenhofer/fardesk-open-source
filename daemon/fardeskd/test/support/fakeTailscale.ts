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
  'if [ "$1" = "whois" ]; then',
  '  if [ -f "$dir/whois-delay" ]; then sleep "$(cat "$dir/whois-delay")"; fi',
  '  if [ -f "$dir/whois-$3.json" ]; then cat "$dir/whois-$3.json"; exit 0; fi',
  '  echo "peer not found" >&2; exit 1',
  "fi",
  "exit 2",
  "",
].join("\n");

/** The tailnet address of the computer the fake tailscale runs on. */
export const SELF_ADDRESS = "100.64.0.1";

export type FakeDevice = { name: string; login: string; tags?: string[]; /** Default: derived from the address. */ stableId?: string };

function whoisJson(address: string, { name, login, tags, stableId }: FakeDevice): string {
  const node = { ID: 1, StableID: stableId ?? `stable-${address}`, Name: name, Addresses: [`${address}/32`], ...(tags === undefined ? {} : { Tags: tags }) };
  return JSON.stringify({ Node: node, UserProfile: { ID: 7, LoginName: tags === undefined ? login : "tagged-devices" } });
}

export type FakeTailscale = {
  dir: string;
  /** The executable itself, for `tailscaleCommands`. */
  binary: string;
  /** What `tailscale whois --json <address>` answers for this address (no device = fails like an unknown address). */
  setDevice(address: string, device: FakeDevice): void;
  /** Replaces the whole whois answer for an address. */
  setRaw(address: string, raw: string): void;
  /** Makes this address unknown to whois again ("peer not found"). */
  clearDevice(address: string): void;
  /** The next `count` calls of `status` fail like an unreachable daemon. */
  failNext(count: number): void;
  /** Every `whois` call now takes this many seconds before it answers. */
  setWhoisDelay(seconds: number): void;
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
  const setRaw = (whoisAddress: string, raw: string): void => { writeFileSync(join(dir, `whois-${whoisAddress}.json`), raw); };
  const fake: FakeTailscale = {
    dir,
    binary: join(dir, "tailscale"),
    setRaw,
    clearDevice: (whoisAddress) => { rmSync(join(dir, `whois-${whoisAddress}.json`), { force: true }); },
    setDevice: (whoisAddress, device) => { setRaw(whoisAddress, whoisJson(whoisAddress, device)); },
    setWhoisDelay: (seconds) => { writeFileSync(join(dir, "whois-delay"), `${seconds}\n`); },
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
