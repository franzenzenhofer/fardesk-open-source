import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import type { NodeBinding } from "./nodeBinding.js";
import { LAST_SEEN_WRITE_INTERVAL_MS, TOMBSTONE_RETENTION_MS, createDeviceRegistry, hashToken } from "./deviceRegistry.js";

const NODE: NodeBinding = { stableId: "node-a", tags: [] };

function setup(): { path: string; clock: { now: number }; open: () => ReturnType<typeof createDeviceRegistry> } {
  const path = join(makeTempDir("fdr-"), "auth-devices.json");
  const clock = { now: Date.parse("2026-11-15T10:00:00.000Z") };
  return { path, clock, open: () => createDeviceRegistry({ path, now: () => new Date(clock.now) }) };
}

describe("issue and authenticate", () => {
  it("stores only the SHA-256 of the token, in a private file", () => {
    const { path, open } = setup();
    const { token, device } = open().issue("iPhone", "100.64.0.2", NODE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    const raw = readFileSync(path, "utf8");
    expect(raw).not.toContain(token);
    expect(raw).toContain(hashToken(token));
    expect(device.tokenHash).toBe(hashToken(token));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("answers ok, revoked and unknown", () => {
    const { open } = setup();
    const registry = open();
    const { token } = registry.issue("iPhone", "1.1.1.1", NODE);
    expect(registry.find(token).state).toBe("ok");
    expect(registry.find("f".repeat(64))).toEqual({ state: "unknown" });
    registry.revoke("iphone");
    expect(registry.find(token)).toEqual({ state: "revoked" });
  });

  it("updates last seen and IP in memory at once but writes the file at most once per interval", () => {
    const { path, clock, open } = setup();
    const registry = open();
    const { device } = registry.issue("Mac", "1.1.1.1", NODE);
    clock.now += 1000;
    registry.seen(device.id, "2.2.2.2");
    expect(registry.list(null)[0]?.lastIp).toBe("2.2.2.2");
    expect(registry.list(null)[0]?.lastSeenAt).toBe(new Date(clock.now).toISOString());
    expect((JSON.parse(readFileSync(path, "utf8")) as { devices: { lastIp: string }[] }).devices[0]?.lastIp).toBe("1.1.1.1");
    clock.now += LAST_SEEN_WRITE_INTERVAL_MS;
    registry.seen(device.id, "3.3.3.3");
    expect((JSON.parse(readFileSync(path, "utf8")) as { devices: { lastIp: string }[] }).devices[0]?.lastIp).toBe("3.3.3.3");
  });
});

describe("node binding", () => {
  it("stores the node (StableID and tags) of every device and survives a restart", () => {
    const { open } = setup();
    open().issue("Server", "100.64.0.9", { stableId: "node-t", tags: ["tag:ci"] });
    expect(open().entries()[0]).toMatchObject({ stableId: "node-t", tags: ["tag:ci"] });
  });

  it("never replaces a known address with a missing one (#107)", () => {
    const { open } = setup();
    const registry = open();
    const { device } = registry.issue("Phone", "100.64.0.2", NODE);
    registry.seen(device.id, "unknown");
    expect(registry.list(null)[0]?.lastIp).toBe("100.64.0.2");
  });

  it("refuses a registry entry that has no node (no legacy entries)", () => {
    const { path, open } = setup();
    const { device } = open().issue("Old", "1.1.1.1", NODE);
    const legacy = { ...device, stableId: undefined, tags: undefined };
    writeFileSync(path, JSON.stringify({ devices: [legacy] }));
    expect(() => open()).toThrow(expect.objectContaining({ code: "internal" }));
  });
});

describe("revoke", () => {
  it("revokes by id, by case-insensitive name, and all; unknown names are not_found", () => {
    const { open } = setup();
    const registry = open();
    const a = registry.issue("Alpha", "1.1.1.1", NODE).device;
    registry.issue("Beta", "1.1.1.1", NODE);
    registry.issue("Gamma", "1.1.1.1", NODE);
    expect(registry.revoke(a.id).map((entry) => entry.name)).toEqual(["Alpha"]);
    expect(registry.revoke("BETA").map((entry) => entry.name)).toEqual(["Beta"]);
    expect(() => registry.revoke("nobody")).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(() => registry.revoke("Alpha")).toThrow(expect.objectContaining({ code: "not_found" }));
    expect(registry.revoke(null).map((entry) => entry.name)).toEqual(["Gamma"]);
    expect(registry.revokeAll()).toEqual([]);
  });

  it("keeps tombstones across a restart and prunes them after the retention", () => {
    const { clock, open } = setup();
    const first = open();
    const { token } = first.issue("Old", "1.1.1.1", NODE);
    first.revoke("Old");
    expect(open().find(token)).toEqual({ state: "revoked" });
    clock.now += TOMBSTONE_RETENTION_MS + 1000;
    expect(open().find(token)).toEqual({ state: "unknown" });
  });
});

describe("push registration", () => {
  it("attaches and detaches an APNs token and survives a restart", () => {
    const { open } = setup();
    const registry = open();
    const { device } = registry.issue("Phone", "1.1.1.1", NODE);
    registry.attachPush(device.id, "ab".repeat(32), "sandbox");
    const reopened = open().entries()[0];
    expect(reopened?.apnsToken).toBe("ab".repeat(32));
    expect(reopened?.apnsEnvironment).toBe("sandbox");
    expect(registry.detachPush(device.id)?.apnsToken).toBe("ab".repeat(32));
    expect(registry.detachPush(device.id)).toBeNull();
    registry.attachPush("missing", "cd".repeat(32), "production");
    expect(registry.entries()[0]?.apnsToken).toBeNull();
  });

  it("refuses a corrupt registry file loudly", () => {
    const { path, open } = setup();
    writeFileSync(path, "{\"devices\": 3}");
    expect(() => open()).toThrow(expect.objectContaining({ code: "internal" }));
  });
});
