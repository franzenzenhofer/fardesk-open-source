import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { resolveBindAddress, runCommand } from "./bind.js";
import { CONFIG_DEFAULTS, type Config } from "./config.js";

const TOKEN = "t".repeat(32);

function configWith(address: string): Config {
  return { ...CONFIG_DEFAULTS, name: "mac", token: TOKEN, bind: { address, port: 4780, allowNonTailnet: false } };
}

async function runNodePrinting(text: string): Promise<string> {
  return runCommand(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(text)})`]);
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected rejection");
}

function tailscaleWorks(): boolean {
  try {
    return /^100\./.test(execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return false;
  }
}

describe("runCommand", () => {
  it("returns stdout of a real process", async () => {
    expect(await runNodePrinting("hello")).toBe("hello");
  });

  it("rejects with the stderr text on non-zero exit", async () => {
    const error = await rejection(runCommand(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]));
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("boom");
  });

  it("rejects with the spawn error when the command does not exist", async () => {
    const error = await rejection(runCommand("fardesk-no-such-binary", []));
    expect((error as Error).message).toContain("ENOENT");
  });
});

describe("resolveBindAddress", () => {
  it("returns a configured literal address without running anything", async () => {
    const run = (): Promise<string> => {
      return Promise.reject(new Error("must not run"));
    };
    expect(await resolveBindAddress(configWith("127.0.0.1"), run)).toBe("127.0.0.1");
  });

  it("takes the first line of a valid tailscale address", async () => {
    const address = await resolveBindAddress(configWith("tailscale"), async () => runNodePrinting("100.64.0.1\nfd7a::1\n"));
    expect(address).toBe("100.64.0.1");
  });

  it("accepts the top of the 100.64.0.0/10 range", async () => {
    expect(await resolveBindAddress(configWith("tailscale"), async () => runNodePrinting("100.127.255.254"))).toBe("100.127.255.254");
  });

  it.each(["garbage", "", "10.0.0.1", "100.63.0.1", "100.128.0.1", "100.64.0.999"])("rejects %j as not a tailscale IPv4", async (output) => {
    const error = await rejection(resolveBindAddress(configWith("tailscale"), async () => runNodePrinting(output)));
    expect(error).toBeInstanceOf(FardeskError);
    expect((error as FardeskError).code).toBe("internal");
    expect((error as FardeskError).message).toContain("100.64.0.0/10");
  });

  it.runIf(tailscaleWorks())("resolves with the real tailscale binary", async () => {
    expect(await resolveBindAddress(configWith("tailscale"), runCommand)).toMatch(/^100\.\d+\.\d+\.\d+$/);
  });
});

describe("bind guard", () => {
  const never = (): Promise<string> => Promise.reject(new Error("must not run"));
  const tlsConfig = (address: string, allowNonTailnet: boolean): Config => ({
    ...configWith(address),
    tls: { cert: "c.pem", key: "k.pem" },
    bind: { address, port: 4780, allowNonTailnet },
  });

  it.each(["127.0.0.1", "127.5.5.5", "::1", "localhost", "100.64.0.1", "100.127.255.254"])("starts on %s without any flag", async (address) => {
    expect(await resolveBindAddress(configWith(address), never)).toBe(address);
  });

  it.each(["0.0.0.0", "192.168.1.20", "10.0.0.5", "100.63.0.1", "100.128.0.1", "::", "203.0.113.9"])("refuses %s without the flag and says why", async (address) => {
    const error = await rejection(resolveBindAddress(configWith(address), never));
    expect(error).toBeInstanceOf(FardeskError);
    expect((error as FardeskError).message).toContain("outside the tailnet");
    expect((error as FardeskError).message).toContain("bind.allowNonTailnet");
  });

  it("still refuses 0.0.0.0 with the flag but without tls, and with tls but without the flag", async () => {
    await expect(resolveBindAddress(configWith("0.0.0.0"), never)).rejects.toThrow("outside the tailnet");
    await expect(resolveBindAddress({ ...configWith("0.0.0.0"), bind: { address: "0.0.0.0", port: 4780, allowNonTailnet: true } }, never)).rejects.toThrow("outside the tailnet");
    await expect(resolveBindAddress(tlsConfig("0.0.0.0", false), never)).rejects.toThrow("outside the tailnet");
  });

  it("starts on 0.0.0.0 with tls and bind.allowNonTailnet: true", async () => {
    expect(await resolveBindAddress(tlsConfig("0.0.0.0", true), never)).toBe("0.0.0.0");
  });
});
