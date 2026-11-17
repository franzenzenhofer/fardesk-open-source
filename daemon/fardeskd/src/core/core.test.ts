import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createBus } from "./bus.js";
import { FardeskError, HTTP_STATUS } from "./errors.js";
import { createLogger, stderrSink } from "./log.js";

const FIXED_NOW = new Date("2026-11-15T10:00:00.000Z");

describe("FardeskError", () => {
  it("carries its contract code and maps to an HTTP status", () => {
    const error = new FardeskError("conflict", "session is locked");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("FardeskError");
    expect(error.code).toBe("conflict");
    expect(error.message).toBe("session is locked");
    expect(HTTP_STATUS[error.code]).toBe(409);
  });
});

describe("bus", () => {
  it("delivers events to every subscriber until it unsubscribes", () => {
    const bus = createBus();
    const first: string[] = [];
    const second: string[] = [];
    const stopFirst = bus.subscribe((event) => first.push(event.type));
    bus.subscribe((event) => second.push(event.type));
    bus.publish({ type: "ping", ts: FIXED_NOW.toISOString() });
    stopFirst();
    bus.publish({ type: "ping", ts: FIXED_NOW.toISOString() });
    expect(first).toEqual(["ping"]);
    expect(second).toEqual(["ping", "ping"]);
  });
});

describe("logger", () => {
  it("writes one JSON line per event with level, message and fields", () => {
    const lines: string[] = [];
    const log = createLogger((line) => lines.push(line), () => FIXED_NOW);
    log.info("started", { port: 4780 });
    log.warn("slow");
    log.error("failed", { code: "internal" });
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual([
      { ts: FIXED_NOW.toISOString(), level: "info", msg: "started", port: 4780 },
      { ts: FIXED_NOW.toISOString(), level: "warn", msg: "slow" },
      { ts: FIXED_NOW.toISOString(), level: "error", msg: "failed", code: "internal" },
    ]);
  });

  it("stderrSink writes the line to the real stderr of a process", () => {
    const script = "import('./src/core/log.ts').then((m) => m.stderrSink('hello-stderr'))";
    const result = spawnSync(process.execPath, ["--import", "tsx", "-e", script], { encoding: "utf8" });
    expect(result.stderr).toContain("hello-stderr\n");
    stderrSink("");
  });
});
