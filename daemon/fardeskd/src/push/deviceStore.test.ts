import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeviceRequest } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { makeTempDir } from "../../test/support/env.js";
import { createDeviceStore } from "./deviceStore.js";

const NOW = new Date("2026-11-15T10:00:00.000Z");
const LATER = new Date("2026-11-16T10:00:00.000Z");

function device(token: string, name = "iPhone"): DeviceRequest {
  return { apnsToken: token.repeat(64), environment: "sandbox", name, notifications: ["permission", "done"] };
}

describe("device store", () => {
  it("lists nothing when the file does not exist yet", () => {
    const store = createDeviceStore(join(makeTempDir(), "devices.json"), () => NOW);
    expect(store.list()).toEqual([]);
  });

  it("upserts, replaces by token, removes, and persists across instances", () => {
    const path = join(makeTempDir(), "nested", "devices.json");
    const store = createDeviceStore(path, () => NOW);
    store.upsert(device("a"));
    store.upsert(device("b"));
    createDeviceStore(path, () => LATER).upsert(device("a", "Renamed"));
    const devices = store.list();
    expect(devices.map((entry) => entry.name)).toEqual(["Renamed", "iPhone"]);
    expect(devices.find((entry) => entry.name === "Renamed")?.registeredAt).toBe(LATER.toISOString());
    expect(devices.find((entry) => entry.name === "iPhone")?.registeredAt).toBe(NOW.toISOString());
    store.remove("a".repeat(64));
    expect(store.list().map((entry) => entry.apnsToken)).toEqual(["b".repeat(64)]);
    store.remove("c".repeat(64));
    expect(store.list()).toHaveLength(1);
  });

  it("uses private permissions and leaves no temp files", () => {
    const dir = join(makeTempDir(), "private");
    const path = join(dir, "devices.json");
    createDeviceStore(path, () => NOW).upsert(device("a"));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual(["devices.json"]);
  });

  it("fails loudly on invalid JSON and on schema violations, naming the path", () => {
    const dir = makeTempDir();
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{not json");
    const wrongShape = join(dir, "shape.json");
    writeFileSync(wrongShape, JSON.stringify({ devices: [{ apnsToken: "x" }] }));
    for (const path of [broken, wrongShape]) {
      const store = createDeviceStore(path, () => NOW);
      expect(() => store.list()).toThrow(FardeskError);
      expect(() => store.list()).toThrow(path);
      expect(() => { store.upsert(device("a")); }).toThrow(path);
    }
  });

  it("rethrows read errors other than a missing file", () => {
    const dir = makeTempDir();
    const path = join(dir, "is-a-directory");
    mkdirSync(path);
    expect(() => createDeviceStore(path, () => NOW).list()).toThrow(/EISDIR/);
  });
});
