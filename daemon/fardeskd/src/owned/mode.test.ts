import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createBus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import { createLogger } from "../core/log.js";
import { createBroker } from "../permissions/broker.js";
import { resumeMode, startMode } from "./mode.js";
import type { ModeDeps } from "./mode.js";
import { createOwnedRunner } from "./runner.js";

const logs: string[] = [];
const deps = (overrides: Partial<ModeDeps> = {}): ModeDeps => ({
  permissionMode: "default",
  allowBypass: false,
  log: createLogger((line) => logs.push(line), () => new Date()),
  ...overrides,
});

describe("startMode", () => {
  it("uses the configured default when the request names no mode", () => {
    expect(startMode(deps(), undefined)).toBe("default");
    expect(startMode(deps({ permissionMode: "acceptEdits" }), undefined)).toBe("acceptEdits");
  });

  it("refuses bypassPermissions while allowBypass is off, with the config key in the message", () => {
    try {
      startMode(deps(), "bypassPermissions");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FardeskError);
      expect((error as FardeskError).code).toBe("unsupported");
      expect((error as FardeskError).message).toContain("owned.allowBypass");
    }
  });

  it("allows bypassPermissions when allowBypass is on, as request or as default", () => {
    expect(startMode(deps({ allowBypass: true }), "bypassPermissions")).toBe("bypassPermissions");
    expect(startMode(deps({ allowBypass: true, permissionMode: "bypassPermissions" }), undefined)).toBe("bypassPermissions");
  });

  it("never blocks the other modes", () => {
    for (const mode of ["default", "acceptEdits", "plan", "dontAsk", "auto"] as const) expect(startMode(deps(), mode)).toBe(mode);
  });
});

describe("resumeMode", () => {
  it("continues in the last mode, or the default when there is none", () => {
    expect(resumeMode(deps(), "plan")).toBe("plan");
    expect(resumeMode(deps(), null)).toBe("default");
  });

  it("downgrades a former bypass session to the default while allowBypass is off, and says so", () => {
    expect(resumeMode(deps(), "bypassPermissions")).toBe("default");
    expect(logs.join("\n")).toContain("resume_bypass_downgraded");
    expect(resumeMode(deps({ allowBypass: true }), "bypassPermissions")).toBe("bypassPermissions");
  });
});

describe("a runner with bypass off", () => {
  it("refuses a new bypass session before it starts any process, and a session without a mode would use default", async () => {
    const dir = makeTempDir("fd-mode-");
    const bus = createBus();
    const runner = createOwnedRunner({
      claudeBinary: "claude-that-must-never-start",
      claudeHome: dir,
      statePath: join(dir, "owned.json"),
      permissionMode: "default",
      allowBypass: false,
      interruptTimeoutMs: 1000,
      clearTimeoutMs: 1000,
      compactTimeoutMs: 1000,
      kill: { timeoutMs: 1000, pollMs: 50 },
      broker: createBroker({ timeoutMs: 1000, bus, now: () => new Date(), newId: randomUUID }),
      log: createLogger(() => undefined, () => new Date()),
      findCwd: () => dir,
      findMode: () => null,
    });
    const request = { cwd: dir, prompt: "hi", worktree: false, model: null, permissionMode: "bypassPermissions" as const };
    await expect(runner.start(request)).rejects.toMatchObject({ code: "unsupported" });
    await runner.close();
  });
});
