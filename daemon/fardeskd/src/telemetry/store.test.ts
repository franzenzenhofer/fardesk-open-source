import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import type { TelemetryReport } from "../contract/schema.js";
import { createTelemetryStore, TELEMETRY_FILE, TELEMETRY_ROTATED_FILE } from "./store.js";

function report(n: number, at = `2026-11-15T10:00:${String(n).padStart(2, "0")}.000Z`): TelemetryReport {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    at,
    message: `error ${n}`,
    area: "feed",
    appVersion: "1.2.0",
    build: "8",
    platform: "iOS 26.1",
  };
}

describe("telemetry store", () => {
  it("appends one JSON line per report and skips ids it already has", () => {
    const dir = makeTempDir("fdtel-");
    const store = createTelemetryStore({ dir });
    expect(store.append([report(1), report(2), report(1)])).toEqual({ accepted: 2, duplicates: 1 });
    expect(store.append([report(2), report(3)])).toEqual({ accepted: 1, duplicates: 1 });
    const lines = readFileSync(join(dir, TELEMETRY_FILE), "utf8").trim().split("\n");
    expect(lines.map((line) => (JSON.parse(line) as TelemetryReport).message)).toEqual(["error 1", "error 2", "error 3"]);
  });

  it("remembers ids across a restart", () => {
    const dir = makeTempDir("fdtel-");
    createTelemetryStore({ dir }).append([report(1)]);
    expect(createTelemetryStore({ dir }).append([report(1)])).toEqual({ accepted: 0, duplicates: 1 });
  });

  it("lists the newest first, honours since and limit", () => {
    const store = createTelemetryStore({ dir: makeTempDir("fdtel-") });
    store.append([report(1), report(3), report(2)]);
    expect(store.list({}).map((r) => r.message)).toEqual(["error 3", "error 2", "error 1"]);
    expect(store.list({ limit: 2 }).map((r) => r.message)).toEqual(["error 3", "error 2"]);
    expect(store.list({ since: "2026-11-15T10:00:02.000Z" }).map((r) => r.message)).toEqual(["error 3", "error 2"]);
  });

  it("rotates to telemetry.1.jsonl past the size limit and keeps only one rotated file", () => {
    const dir = makeTempDir("fdtel-");
    const store = createTelemetryStore({ dir, maxBytes: 400 });
    for (let n = 1; n <= 12; n += 1) store.append([report(n)]);
    expect(existsSync(join(dir, TELEMETRY_ROTATED_FILE))).toBe(true);
    expect(existsSync(join(dir, "telemetry.2.jsonl"))).toBe(false);
    const listed = store.list({ limit: 100 });
    expect(listed[0]?.message).toBe("error 12");
    expect(listed.length).toBeLessThan(12);
    expect(listed.length).toBeGreaterThan(3);
  });

  it("ignores damaged lines in an existing file", () => {
    const dir = makeTempDir("fdtel-");
    writeFileSync(join(dir, TELEMETRY_FILE), `not json\n${JSON.stringify({ nope: true })}\n${JSON.stringify(report(1))}\n`);
    const store = createTelemetryStore({ dir });
    expect(store.list({}).map((r) => r.message)).toEqual(["error 1"]);
  });
});
