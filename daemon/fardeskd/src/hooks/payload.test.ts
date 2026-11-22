import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fixturePath } from "../../test/support/env.js";
import { parseHookPayload } from "./payload.js";

const HOOK_DIR = fixturePath("hooks");
const FIXTURES = readdirSync(HOOK_DIR).filter((name) => name.endsWith(".json"));

function load(name: string): unknown {
  return JSON.parse(readFileSync(fixturePath("hooks", name), "utf8"));
}

describe("parseHookPayload", () => {
  it("has the 13 expected fixtures", () => {
    expect(FIXTURES).toHaveLength(13);
  });

  it.each(FIXTURES)("parses %s and keeps the raw object", (name) => {
    const result = parseHookPayload(load(name));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.raw).toEqual(load(name));
    expect(result.event.hookEventName).toBe((load(name) as { hook_event_name: string }).hook_event_name);
  });

  it("maps the permission request fields to camelCase", () => {
    const result = parseHookPayload(load("PermissionRequest-bash.json"));
    if (!result.ok) throw new Error(result.error);
    expect(result.event.toolName).toBe("Bash");
    expect(result.event.toolInput).toEqual({ command: "touch a1.txt", description: "Create empty file a1.txt" });
    expect(result.event.permissionSuggestions).toHaveLength(2);
    expect(result.event.permissionMode).toBe("default");
    expect(result.event.transcriptPath).toContain("/home/dev/.claude/projects/");
  });

  it("maps Stop, SessionEnd and SessionStart fields", () => {
    const stop = parseHookPayload(load("Stop.json"));
    const end = parseHookPayload(load("SessionEnd-other.json"));
    const start = parseHookPayload(load("SessionStart.json"));
    if (!stop.ok || !end.ok || !start.ok) throw new Error("fixture rejected");
    expect(typeof stop.event.lastAssistantMessage).toBe("string");
    expect(end.event.reason).toBe("other");
    expect(start.event.source).toBe("startup");
    expect(start.event.model).toBe("claude-sonnet-5-5");
    expect(start.event.cwd).toBe("/home/dev/fardesk-spike/c");
  });

  it("omits absent optional fields", () => {
    const result = parseHookPayload({ session_id: "s", hook_event_name: "Stop" });
    expect(result).toEqual({
      ok: true,
      event: { sessionId: "s", hookEventName: "Stop", raw: { session_id: "s", hook_event_name: "Stop" } },
    });
  });

  it("rejects a missing session id and a wrong type", () => {
    expect(parseHookPayload({ hook_event_name: "Stop" }).ok).toBe(false);
    expect(parseHookPayload({ session_id: "s", hook_event_name: "Stop", cwd: 5 }).ok).toBe(false);
    expect(parseHookPayload("text").ok).toBe(false);
  });
});
