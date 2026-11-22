// Node identity against a real (fake) `tailscale` executable that answers recorded, anonymised whois JSON.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { SELF_ADDRESS, createFakeTailscale } from "../../test/support/fakeTailscale.js";
import type { FakeTailscale } from "../../test/support/fakeTailscale.js";
import { createRunCommand, runCommand } from "../config/bind.js";
import type { RunCommand } from "../config/bind.js";
import { NOT_IN_TAILNET_MESSAGE, TAILSCALE_UNAVAILABLE_MESSAGE, WHOIS_CACHE_MS, createNodeIdentity } from "./nodeIdentity.js";
import type { NodeIdentity } from "./nodeIdentity.js";

const FIXTURES = join(import.meta.dirname, "..", "..", "test", "fixtures", "whois");
const PHONE = "100.64.0.7";
const RUNNER = "100.64.0.9";

let tailscale: FakeTailscale;
let clock: { now: number };
let whoisCalls: number;

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), "utf8");

function identity(run: RunCommand = runCommand, commands: string[] = [tailscale.binary]): NodeIdentity {
  const counting: RunCommand = async (command, args) => {
    if (args[0] === "whois") whoisCalls += 1;
    return run(command, args);
  };
  return createNodeIdentity({ run: counting, commands, now: () => clock.now, log: () => undefined });
}

const failure = async (promise: Promise<unknown>): Promise<{ code: string; message: string }> => {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  return error as { code: string; message: string };
};

beforeEach(() => {
  tailscale = createFakeTailscale(SELF_ADDRESS);
  tailscale.setRaw(SELF_ADDRESS, fixture("own-node.json"));
  tailscale.setRaw(PHONE, fixture("ios-peer.json"));
  tailscale.setRaw(RUNNER, fixture("tagged-node.json"));
  clock = { now: 1_000_000 };
  whoisCalls = 0;
});

describe("node identity", () => {
  it("reads StableID, user, tags and addresses of an own node, an iOS peer and a tagged node", async () => {
    const nodes = identity();
    expect(await nodes.self()).toMatchObject({ stableId: "nSTABLEOWN0001CNTRL", userId: "100000000000001", tags: [], addresses: [SELF_ADDRESS, "fd7a:115c:a1e0::1"], device: "studio", login: "owner@example.com" });
    expect(await nodes.resolve(PHONE)).toMatchObject({ stableId: "nSTABLEPHONE07CNTRL", userId: "100000000000001", tags: [] });
    expect(await nodes.resolve(RUNNER)).toMatchObject({ stableId: "nSTABLETAGGED09CNTRL", userId: "100000000000002", tags: ["tag:ci"], login: null });
  });

  it("gives two devices of the same user different StableIDs, so the user id never identifies a device", async () => {
    const nodes = identity();
    const [own, phone] = [await nodes.self(), await nodes.resolve(PHONE)];
    expect(own.userId).toBe(phone.userId);
    expect(own.stableId).not.toBe(phone.stableId);
  });

  it("treats an address Tailscale does not know (peer not found) as not in the tailnet: 401", async () => {
    const error = await failure(identity().resolve("100.64.0.99"));
    expect(error).toMatchObject({ code: "unauthorized", message: NOT_IN_TAILNET_MESSAGE });
  });

  it("refuses an address that is no tailnet address, and a missing address, without asking Tailscale", async () => {
    const nodes = identity();
    expect(await failure(nodes.resolve("2001:db8::5"))).toMatchObject({ code: "unauthorized" });
    expect(await failure(nodes.resolve("unknown"))).toMatchObject({ code: "unauthorized" });
    expect(whoisCalls).toBe(0);
  });

  it("refuses an answer that does not list the asked address", async () => {
    tailscale.setRaw("100.64.0.8", fixture("ios-peer.json"));
    expect(await failure(identity().resolve("100.64.0.8"))).toMatchObject({ code: "unauthorized" });
  });

  it("understands an IPv4-mapped IPv6 source address", async () => {
    expect((await identity().resolve(`::ffff:${PHONE}`)).stableId).toBe("nSTABLEPHONE07CNTRL");
  });

  it("fails closed with 503 when tailscaled is stopped, not installed, or answers nonsense", async () => {
    tailscale.setAddress(null);
    expect(await failure(identity().resolve(PHONE))).toMatchObject({ code: "tailscale_unavailable", message: TAILSCALE_UNAVAILABLE_MESSAGE });
    expect(await failure(identity(runCommand, ["no-such-tailscale-command"]).resolve(PHONE))).toMatchObject({ code: "tailscale_unavailable" });
    tailscale.setAddress(SELF_ADDRESS);
    tailscale.setRaw(PHONE, "{not json");
    expect(await failure(identity().resolve(PHONE))).toMatchObject({ code: "tailscale_unavailable" });
  });

  it("fails closed with 503 when whois hangs past the command deadline", async () => {
    tailscale.setWhoisDelay(3);
    expect(await failure(identity(createRunCommand(300)).resolve(PHONE))).toMatchObject({ code: "tailscale_unavailable" });
  });
});

describe("whois cache", () => {
  it("asks once per address within the lifetime, again after it, and always when asked fresh", async () => {
    const nodes = identity();
    await nodes.resolve(PHONE);
    await nodes.resolve(PHONE);
    expect(whoisCalls).toBe(1);
    clock.now += WHOIS_CACHE_MS - 1;
    await nodes.resolve(PHONE);
    expect(whoisCalls).toBe(1);
    clock.now += 1;
    await nodes.resolve(PHONE);
    expect(whoisCalls).toBe(2);
    await nodes.resolve(PHONE, true);
    expect(whoisCalls).toBe(3);
  });

  it("does not cache a failure", async () => {
    const nodes = identity();
    await failure(nodes.resolve("100.64.0.99"));
    tailscale.setRaw("100.64.0.99", fixture("ios-peer.json").replace("100.64.0.7", "100.64.0.99"));
    expect((await nodes.resolve("100.64.0.99")).stableId).toBe("nSTABLEPHONE07CNTRL");
  });
});
