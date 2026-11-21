import { beforeEach, describe, expect, it } from "vitest";
import { SELF_ADDRESS, createFakeTailscale } from "../../test/support/fakeTailscale.js";
import type { FakeTailscale } from "../../test/support/fakeTailscale.js";
import { runCommand } from "../config/bind.js";
import { createLogger } from "../core/log.js";
import type { FardeskError } from "../core/errors.js";
import { createLoginLimiter } from "./rateLimit.js";
import { admitTailnetCaller, createTailnetGate, PAIRING_REFUSED_MESSAGE, PAIRING_UNVERIFIED_MESSAGE, PairingRefused } from "./tailnetCaller.js";
import type { TailnetGate, TailnetPolicy } from "./tailnetCaller.js";

const CALLER = "100.64.0.7";
const TAILNET = "example.ts.net";
const NO_POLICY: TailnetPolicy = { allowedUsers: [], allowedTags: [] };

let tailscale: FakeTailscale;

beforeEach(() => {
  tailscale = createFakeTailscale(SELF_ADDRESS);
  tailscale.setDevice(SELF_ADDRESS, { name: `studio.${TAILNET}.`, login: "owner@example.com" });
});

const gateFor = (policy: TailnetPolicy = NO_POLICY, commands: string[] = [tailscale.binary]): TailnetGate =>
  createTailnetGate({ run: runCommand, commands, policy, log: createLogger(() => undefined, () => new Date()) });

async function refusal(promise: Promise<unknown>): Promise<PairingRefused> {
  const error: unknown = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(PairingRefused);
  return error as PairingRefused;
}

describe("tailnet gate", () => {
  it("admits a device of the same tailnet user", async () => {
    tailscale.setDevice(CALLER, { name: `phone.${TAILNET}.`, login: "Owner@example.com" });
    await expect(gateFor().check(CALLER)).resolves.toBe("phone");
  });

  it("admits the same computer without asking Tailscale", async () => {
    await expect(gateFor(NO_POLICY, ["no-such-tailscale-command"]).check("127.0.0.1")).resolves.toBeNull();
    await expect(gateFor(NO_POLICY, ["no-such-tailscale-command"]).check("::ffff:127.0.0.1")).resolves.toBeNull();
  });

  it("refuses a device of another user and names the device for the audit", async () => {
    tailscale.setDevice(CALLER, { name: `laptop.${TAILNET}.`, login: "guest@example.com" });
    const error = await refusal(gateFor().check(CALLER));
    expect(error.message).toBe(PAIRING_REFUSED_MESSAGE);
    expect(error.code).toBe("forbidden");
    expect(error.device).toBe("laptop");
  });

  it("refuses a device shared in from another tailnet, even one with the same login", async () => {
    tailscale.setDevice(CALLER, { name: "phone.other.ts.net.", login: "owner@example.com" });
    expect((await refusal(gateFor().check(CALLER))).message).toBe(PAIRING_REFUSED_MESSAGE);
    tailscale.setDevice(CALLER, { name: "phone.other.ts.net.", login: "friend@example.org" });
    expect((await refusal(gateFor().check(CALLER))).message).toBe(PAIRING_REFUSED_MESSAGE);
  });

  it("admits another user the owner allowed by name, case-insensitively, and nobody else", async () => {
    tailscale.setDevice(CALLER, { name: `tablet.${TAILNET}.`, login: "Partner@example.com" });
    await expect(gateFor({ allowedUsers: ["partner@EXAMPLE.com"], allowedTags: [] }).check(CALLER)).resolves.toBe("tablet");
    await refusal(gateFor({ allowedUsers: ["someone@example.com"], allowedTags: [] }).check(CALLER));
  });

  it("refuses a tagged device unless its tag is listed", async () => {
    tailscale.setDevice(CALLER, { name: `server.${TAILNET}.`, login: "owner@example.com", tags: ["tag:ci"] });
    await refusal(gateFor().check(CALLER));
    await refusal(gateFor({ allowedUsers: ["owner@example.com"], allowedTags: [] }).check(CALLER));
    await expect(gateFor({ allowedUsers: [], allowedTags: ["tag:ci"] }).check(CALLER)).resolves.toBe("server");
  });

  it("refuses a tag of another tailnet even when the owner listed that tag", async () => {
    tailscale.setDevice(CALLER, { name: "server.other.ts.net.", login: "owner@example.com", tags: ["tag:ci"] });
    await refusal(gateFor({ allowedUsers: [], allowedTags: ["tag:ci"] }).check(CALLER));
  });

  it("limits parallel checks of slow whois calls so Tailscale processes cannot pile up", async () => {
    tailscale.setDevice(CALLER, { name: `phone.${TAILNET}.`, login: "owner@example.com" });
    tailscale.setWhoisDelay(1);
    const limiter = createLoginLimiter({ maxFailures: 10, windowMs: 60_000, now: () => Date.now() });
    const gate = gateFor();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => admitTailnetCaller(limiter, gate, CALLER).then(() => "ok", (e: unknown) => (e as FardeskError).code)),
    );
    expect(outcomes.filter((outcome) => outcome === "ok")).toHaveLength(4);
    expect(outcomes.filter((outcome) => outcome === "rate_limited")).toHaveLength(4);
  });

  it("fails closed with a clear error when whois fails for the caller", async () => {
    const error = await refusal(gateFor().check("100.64.0.99"));
    expect(error.message).toBe(PAIRING_UNVERIFIED_MESSAGE);
    expect(error.device).toBeNull();
  });

  it("fails closed when whois answers nonsense", async () => {
    tailscale.setRaw(CALLER, "{not json");
    expect((await refusal(gateFor().check(CALLER))).message).toBe(PAIRING_UNVERIFIED_MESSAGE);
    tailscale.setRaw(CALLER, JSON.stringify({ Node: "x" }));
    expect((await refusal(gateFor().check(CALLER))).message).toBe(PAIRING_UNVERIFIED_MESSAGE);
  });

  it("fails closed when this computer cannot be identified", async () => {
    const lonely = createFakeTailscale(SELF_ADDRESS);
    lonely.setDevice(CALLER, { name: `phone.${TAILNET}.`, login: "owner@example.com" });
    const error = await refusal(gateFor(NO_POLICY, [lonely.binary]).check(CALLER));
    expect(error.message).toBe(PAIRING_UNVERIFIED_MESSAGE);
    expect(error.device).toBe("phone");
  });

  it("fails closed when Tailscale is not installed", async () => {
    expect((await refusal(gateFor(NO_POLICY, ["no-such-tailscale-command"]).check(CALLER))).message).toBe(PAIRING_UNVERIFIED_MESSAGE);
  });
});
