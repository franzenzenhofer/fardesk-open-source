import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FardeskError } from "../core/errors.js";
import { SANDBOX_ENV } from "../core/sandbox.js";
import { makeTempDir } from "../../test/support/env.js";
import { loadConfig, updateConfigFile } from "./config.js";

const TOKEN = "a".repeat(32);

afterEach(() => {
  vi.unstubAllEnvs();
});

function load(extra: Record<string, unknown>): ReturnType<typeof loadConfig> {
  const path = join(makeTempDir(), "config.json");
  writeFileSync(path, JSON.stringify({ name: "m", token: TOKEN, ...extra }));
  return loadConfig(path);
}

function message(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FardeskError);
    return (error as FardeskError).message;
  }
  throw new Error("expected a throw");
}

/** A real config as the owner runs it: outside the test sandbox. */
function realConfig(): void {
  vi.stubEnv(SANDBOX_ENV, "");
}

describe("Tailscale only: a real config", () => {
  it("accepts the tailscale address, with the port as the one free choice", () => {
    realConfig();
    expect(load({ bind: { address: "tailscale", port: 4999 } }).bind).toEqual({ address: "tailscale", port: 4999 });
    expect(load({}).bind.address).toBe("tailscale");
  });

  it.each(["127.0.0.1", "localhost", "::1", "192.168.1.20", "10.0.0.5", "0.0.0.0", "203.0.113.9", "100.64.0.1"])(
    "refuses the literal address %s at load",
    (address) => {
      realConfig();
      expect(message(() => load({ bind: { address, port: 4780 } }))).toContain("Tailscale only, no other way");
    },
  );

  it("refuses a peer outside the tailnet and accepts a tailnet peer", () => {
    realConfig();
    const peer = (url: string): Record<string, unknown> => ({ peers: [{ name: "box", url }] });
    expect(load(peer("http://100.64.0.9:4780")).peers).toHaveLength(1);
    for (const url of ["http://192.168.1.9:4780", "http://127.0.0.1:4780", "http://example.com:4780"]) {
      expect(message(() => load(peer(url)))).toContain("is not a tailnet address");
    }
  });

  it("refuses an https peer: Fardesk 4 uses Tailscale for encryption and has no own TLS", () => {
    realConfig();
    const config = { peers: [{ name: "box", url: "https://100.64.0.9:4780" }] };
    expect(() => load(config)).toThrow();
    expect(message(() => load({ peers: [{ name: "box", url: "https://100.64.0.9:4780", pin: "x" }] }))).toBeTruthy();
  });

  it("refuses a bad peer at write time, not at the next start, and leaves the file untouched", () => {
    realConfig();
    const path = join(makeTempDir(), "config.json");
    writeFileSync(path, JSON.stringify({ name: "m", token: TOKEN }));
    const before = readFileSync(path, "utf8");
    expect(message(() => { updateConfigFile(path, { peers: [{ name: "box", url: "http://192.168.1.9:4780" }] }); })).toContain("is not a tailnet address");
    expect(readFileSync(path, "utf8")).toBe(before);
    updateConfigFile(path, { peers: [{ name: "box", url: "http://100.64.0.9:4780" }] });
    expect(loadConfig(path).peers).toHaveLength(1);
  });

  it("fails loudly on every key removed with the other ways in, naming the key", () => {
    realConfig();
    const oldKey = ["pass", "wordHash"].join("");
    const oldSwitch = ["allow", "NonTailnet"].join("");
    expect(message(() => load({ auth: { [oldKey]: "scrypt$x" } }))).toContain(`auth.${oldKey}`);
    expect(message(() => load({ bind: { address: "tailscale", port: 4780, [oldSwitch]: true } }))).toContain(`bind.${oldSwitch}`);
  });
});

describe("Tailscale only: the test sandbox", () => {
  it("lets a test daemon sit on loopback, and nothing else", () => {
    expect(load({ bind: { address: "127.0.0.1", port: 4780 } }).bind.address).toBe("127.0.0.1");
    expect(message(() => load({ bind: { address: "192.168.1.20", port: 4780 } }))).toContain("Tailscale only");
    expect(load({ peers: [{ name: "p", url: "http://127.0.0.1:4781" }] }).peers).toHaveLength(1);
  });
});
