import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixturePath, makeTempDir } from "../../test/support/env.js";
import { buildHookEntries, HOOK_MARKER } from "./command.js";
import { installHooks, uninstallHooks } from "./installer.js";

const NOW = new Date("2026-11-15T14:05:09.456Z");
const BACKUP_SUFFIX = ".fardesk-bak-20261115-140509";
const ENTRIES = buildHookEntries({ socketPath: "/tmp/fd/hook.sock", permissionTimeoutSeconds: 120 });
const OUR_EVENTS = ["PermissionRequest", "SessionEnd", "SessionStart", "Stop"];

type Json = Record<string, unknown>;

function copyFixture(name: string): string {
  const dir = makeTempDir();
  const target = join(dir, "settings.json");
  copyFileSync(fixturePath("hooks", "settings", name), target);
  return target;
}

function read(path: string): Json {
  return JSON.parse(readFileSync(path, "utf8")) as Json;
}

function hooksOf(settings: Json): Record<string, unknown[]> {
  return settings["hooks"] as Record<string, unknown[]>;
}

function ourCommandCount(settings: Json): number {
  return (JSON.stringify(settings).match(/http:\/\/fardesk\/hook/g) ?? []).length;
}

describe("installHooks", () => {
  it("creates a missing file and its parent dir with only our hooks and no backup", () => {
    const path = join(makeTempDir(), "nested", ".claude", "settings.json");
    const result = installHooks(path, ENTRIES, NOW);
    expect(result).toEqual({ changed: true, backupPath: null, events: OUR_EVENTS.slice().sort() });
    expect(read(path)).toEqual({ hooks: ENTRIES });
    expect(readFileSync(path, "utf8")).toBe(`${JSON.stringify({ hooks: ENTRIES }, null, 2)}\n`);
    expect(readdirSync(join(path, ".."))).toEqual(["settings.json"]);
  });

  it("backs up an existing empty object before writing", () => {
    const path = copyFixture("empty-object.json");
    const result = installHooks(path, ENTRIES, NOW);
    expect(result.changed).toBe(true);
    expect(result.backupPath).toBe(`${path}${BACKUP_SUFFIX}`);
    expect(readFileSync(`${path}${BACKUP_SUFFIX}`, "utf8")).toBe("{}\n");
    expect(read(path)).toEqual({ hooks: ENTRIES });
  });

  it("keeps unrelated keys when the file has no hooks key", () => {
    const path = copyFixture("no-hooks.json");
    const before = read(path);
    installHooks(path, ENTRIES, NOW);
    const after = read(path);
    expect({ ...after, hooks: undefined }).toEqual({ ...before, hooks: undefined });
    expect(Object.keys(after)).toEqual(["model", "theme", "env", "hooks"]);
    expect(hooksOf(after)).toEqual(ENTRIES);
  });

  it("appends our groups at the end and leaves existing groups deep-equal, also after uninstall", () => {
    const path = copyFixture("existing-hooks.json");
    const before = read(path);
    const result = installHooks(path, ENTRIES, NOW);
    expect(result.events).toEqual(["PermissionRequest", "SessionEnd", "SessionStart", "Stop"]);
    const after = read(path);
    const hooks = hooksOf(after);
    for (const event of ["PreToolUse", "Stop", "UserPromptSubmit"]) {
      const original = hooksOf(before)[event] as unknown[];
      expect(hooks[event]?.slice(0, original.length)).toEqual(original);
    }
    expect(hooks["PreToolUse"]).toEqual(hooksOf(before)["PreToolUse"]);
    expect(hooks["UserPromptSubmit"]).toEqual(hooksOf(before)["UserPromptSubmit"]);
    expect(hooks["Stop"]?.at(-1)).toEqual(ENTRIES["Stop"]?.[0]);
    expect(after["model"]).toBe("opus");
    expect(readFileSync(path, "utf8")).toMatch(/\n$/);
    expect(readFileSync(path, "utf8")).toContain('\n  "model"');

    const removed = uninstallHooks(path, NOW);
    expect(removed.changed).toBe(true);
    expect(read(path)).toEqual(before);
  });

  it("is idempotent: second install changes nothing and makes no new backup", () => {
    const path = copyFixture("existing-hooks.json");
    installHooks(path, ENTRIES, NOW);
    const content = readFileSync(path, "utf8");
    const files = readdirSync(join(path, ".."));
    const second = installHooks(path, ENTRIES, new Date("2027-01-01T00:00:00Z"));
    expect(second).toEqual({ changed: false, backupPath: null, events: [] });
    expect(readFileSync(path, "utf8")).toBe(content);
    expect(readdirSync(join(path, ".."))).toEqual(files);
  });

  it("replaces our entries when the timeouts differ, without duplicates", () => {
    const path = copyFixture("existing-hooks.json");
    installHooks(path, ENTRIES, NOW);
    const longer = buildHookEntries({ socketPath: "/tmp/fd/hook.sock", permissionTimeoutSeconds: 300 });
    const result = installHooks(path, longer, new Date("2026-11-15T15:00:00Z"));
    expect(result.changed).toBe(true);
    expect(result.events).toEqual(["PermissionRequest"]);
    expect(result.backupPath).toBe(`${path}.fardesk-bak-20261115-150000`);
    expect(ourCommandCount(read(path))).toBe(4);
    expect(JSON.stringify(read(path))).toContain("-m 305");
    expect(JSON.stringify(read(path))).not.toContain("-m 125");
  });

  it("strips our hook out of a mixed group and drops a group made only of ours", () => {
    const path = join(makeTempDir(), "settings.json");
    const ours = ENTRIES["Stop"]?.[0]?.hooks[0];
    const theirs = { type: "command", command: "echo mine" };
    const mixed = {
      hooks: {
        Stop: [
          { matcher: "x", hooks: [theirs, ours] },
          { hooks: [ours] },
          "not a group",
          { matcher: "no hooks key" },
          { hooks: [] },
        ],
      },
    };
    writeFileSync(path, JSON.stringify(mixed));
    installHooks(path, ENTRIES, NOW);
    expect(hooksOf(read(path))["Stop"]).toEqual([
      { matcher: "x", hooks: [theirs] },
      "not a group",
      { matcher: "no hooks key" },
      { hooks: [] },
      ENTRIES["Stop"]?.[0],
    ]);
  });

  it("keeps the file mode of an existing file and uses 600 for a new one", () => {
    const path = copyFixture("empty-object.json");
    chmodSync(path, 0o640);
    installHooks(path, ENTRIES, NOW);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    const created = join(makeTempDir(), "new.json");
    installHooks(created, ENTRIES, NOW);
    expect(statSync(created).mode & 0o777).toBe(0o600);
  });

  it("throws invalid_request and writes nothing for broken files", () => {
    const cases: [string, string][] = [
      ["not json", "not valid JSON"],
      ["[1]", "top level is not an object"],
      ['{"hooks": []}', "`hooks` is not an object"],
      ['{"hooks": {"Stop": {}}}', "hooks.Stop is not an array"],
    ];
    for (const [content, message] of cases) {
      const path = join(makeTempDir(), "settings.json");
      writeFileSync(path, content);
      expect(() => installHooks(path, ENTRIES, NOW)).toThrow(expect.objectContaining({ code: "invalid_request", message: expect.stringContaining(message) as string }) as Error);
      expect(readFileSync(path, "utf8")).toBe(content);
      expect(readdirSync(join(path, ".."))).toEqual(["settings.json"]);
    }
  });

  it("rethrows read errors other than a missing file", () => {
    expect(() => installHooks(makeTempDir(), ENTRIES, NOW)).toThrow(/EISDIR/);
  });
});

describe("uninstallHooks", () => {
  it("removes exactly our hooks, empty event arrays and the empty hooks key", () => {
    const path = copyFixture("no-hooks.json");
    const before = read(path);
    installHooks(path, ENTRIES, NOW);
    const result = uninstallHooks(path, new Date("2026-11-15T16:00:00Z"));
    expect(result.events).toEqual(OUR_EVENTS.slice().sort());
    expect(result.backupPath).toBe(`${path}.fardesk-bak-20261115-160000`);
    expect(read(path)).toEqual(before);
    expect(existsSync(`${path}.fardesk-bak-20261115-160000`)).toBe(true);
  });

  it("does nothing for a missing file", () => {
    const path = join(makeTempDir(), "missing", "settings.json");
    expect(uninstallHooks(path, NOW)).toEqual({ changed: false, backupPath: null, events: [] });
    expect(existsSync(join(path, ".."))).toBe(false);
  });

  it("does nothing when nothing of ours is installed", () => {
    for (const name of ["empty-object.json", "no-hooks.json", "existing-hooks.json"]) {
      const path = copyFixture(name);
      const before = readFileSync(path, "utf8");
      expect(uninstallHooks(path, NOW)).toEqual({ changed: false, backupPath: null, events: [] });
      expect(readFileSync(path, "utf8")).toBe(before);
      expect(readdirSync(join(path, ".."))).toEqual(["settings.json"]);
    }
  });

  it("throws invalid_request for a broken file and keeps it", () => {
    const dir = makeTempDir();
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "settings.json");
    writeFileSync(path, "{broken");
    expect(() => uninstallHooks(path, NOW)).toThrow(expect.objectContaining({ code: "invalid_request" }) as Error);
    expect(readFileSync(path, "utf8")).toBe("{broken");
    expect(HOOK_MARKER).toBe("http://fardesk/hook");
  });
});
