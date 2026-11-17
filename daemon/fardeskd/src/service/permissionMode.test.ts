import { afterEach, describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import { configSchema } from "../config/config.js";
import { sessionSummarySchema } from "../contract/schema.js";
import type { PermissionMode } from "../contract/schema.js";
import { knownPermissionMode } from "../sessions/permissionMode.js";
import { createRealOwned } from "./ownedFactory.js";
import type { OwnedContext } from "./types.js";

const BYPASS_FIXTURE = "01-simple-session";
const DEFAULT_FIXTURE = "03-grep-read-run";
const AUTO_FIXTURE = "21-claude-desktop-session";
const NO_MODE_FIXTURE = "11-task-tools";

let daemon: TestDaemon | null = null;
let context: OwnedContext | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
  context = null;
});

async function boot(): Promise<TestDaemon> {
  daemon = await startTestDaemon({}, {
    createOwned: (ownedContext) => {
      context = ownedContext;
      return createRealOwned(ownedContext);
    },
  });
  return daemon;
}

async function seedTranscript(fixture: string): Promise<string> {
  const booted = await boot();
  const { sessionId } = booted.home.addTranscript({ fixture });
  await waitUntil(() => booted.services.sessions().some((session) => session.id === sessionId));
  return sessionId;
}

const findMode = (id: string): PermissionMode | null => {
  if (context === null) throw new Error("daemon not booted");
  return context.findMode(id);
};

describe("the mode a session last ran in", () => {
  it("defaults owned sessions to default mode with bypass off and rejects a mode Claude Code does not know", () => {
    const owned = configSchema.parse({ name: "m", token: "k".repeat(48) }).owned;
    expect(owned).toMatchObject({ permissionMode: "default", allowBypass: false });
    expect(() => configSchema.parse({ name: "m", token: "k".repeat(48), owned: { permissionMode: "yolo", interruptTimeoutMs: 5000 } })).toThrow();
  });

  it("maps transcript mode strings to contract modes and unknown ones to null", () => {
    expect(knownPermissionMode("bypassPermissions")).toBe("bypassPermissions");
    expect(knownPermissionMode("default")).toBe("default");
    expect(knownPermissionMode("yolo")).toBeNull();
    expect(knownPermissionMode(null)).toBeNull();
  });

  it.each([
    [BYPASS_FIXTURE, "bypassPermissions"],
    [DEFAULT_FIXTURE, "default"],
    [AUTO_FIXTURE, "auto"],
    [NO_MODE_FIXTURE, null],
  ])("reports %s as %s in the summary and to resume, takeover and fork", async (fixture, expected) => {
    const id = await seedTranscript(fixture);
    const response = await daemon?.call("GET", "/v1/sessions");
    const summaries = (response?.json as unknown[]).map((item) => sessionSummarySchema.parse(item));
    expect(summaries.find((summary) => summary.id === id)?.permissionMode).toBe(expected);
    expect(findMode(id)).toBe(expected);
  });

  it("knows no mode for a session it has never seen", async () => {
    await boot();
    expect(findMode("no-such-session")).toBeNull();
  });
});
