import { describe, expect, it } from "vitest";
import { buildHookCommand, buildHookEntries, HOOK_MARKER } from "./command.js";

describe("buildHookCommand", () => {
  it("builds the exact curl line", () => {
    expect(buildHookCommand("/tmp/s/hook.sock", 0.25)).toBe(
      "curl -sf -m 0.25 --unix-socket '/tmp/s/hook.sock' -H 'Content-Type: application/json' --data-binary @- http://fardesk/hook 2>/dev/null || true",
    );
  });

  it("quotes single quotes in the socket path", () => {
    expect(buildHookCommand("/tmp/it's/hook.sock", 1)).toContain(String.raw`--unix-socket '/tmp/it'\''s/hook.sock'`);
  });

  it("carries the marker", () => {
    expect(buildHookCommand("/x", 1)).toContain(HOOK_MARKER);
  });
});

describe("buildHookEntries", () => {
  const entries = buildHookEntries({ socketPath: "/tmp/h.sock", permissionTimeoutSeconds: 120 });

  it("registers exactly four events", () => {
    expect(Object.keys(entries).sort()).toEqual(["PermissionRequest", "SessionEnd", "SessionStart", "Stop"]);
  });

  it("makes PermissionRequest synchronous with curl and hook timeouts above the permission timeout", () => {
    expect(entries["PermissionRequest"]).toEqual([
      {
        hooks: [{ type: "command", command: buildHookCommand("/tmp/h.sock", 125), timeout: 130 }],
      },
    ]);
  });

  it("makes the other three async with a 0.25 s curl limit and no matcher", () => {
    for (const event of ["Stop", "SessionStart", "SessionEnd"]) {
      expect(entries[event]).toEqual([
        { hooks: [{ type: "command", command: buildHookCommand("/tmp/h.sock", 0.25), async: true }] },
      ]);
    }
    expect(JSON.stringify(entries)).not.toContain("matcher");
  });
});
