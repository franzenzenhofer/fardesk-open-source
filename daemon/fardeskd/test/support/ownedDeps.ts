// Deps of an owned runner that must never start a process (the binary does not exist): for refusal and environment tests.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createBus } from "../../src/core/bus.js";
import { createLogger } from "../../src/core/log.js";
import type { OwnedRunnerDeps } from "../../src/owned/runner.js";
import { createBroker } from "../../src/permissions/broker.js";

export function neverStartingDeps(dir: string, overrides: Partial<OwnedRunnerDeps> = {}): OwnedRunnerDeps {
  return {
    claudeBinary: "claude-that-must-never-start",
    claudeHomes: [{ path: dir, name: "test" }],
    statePath: join(dir, "owned.json"),
    permissionMode: "default",
    allowBypass: false,
    interruptTimeoutMs: 1000,
    clearTimeoutMs: 1000,
    compactTimeoutMs: 1000,
    kill: { timeoutMs: 1000, pollMs: 50 },
    broker: createBroker({ timeoutMs: 1000, bus: createBus(), now: () => new Date(), newId: randomUUID, allowBypass: true }),
    log: createLogger(() => undefined, () => new Date()),
    findCwd: () => dir,
    findHome: () => dir,
    findMode: () => null,
    ...overrides,
  };
}
