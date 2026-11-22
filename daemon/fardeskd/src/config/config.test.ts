import { mkdirSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FardeskError } from "../core/errors.js";
import { makeTempDir } from "../../test/support/env.js";
import { CONFIG_DEFAULTS, defaultConfigPath, expandHome, loadConfig, updateConfigFile, writeInitialConfig } from "./config.js";

const TOKEN = "a".repeat(32);
const MODE_MASK = 0o777;
const home = homedir();

function writeConfig(content: unknown): string {
  const path = join(makeTempDir(), "config.json");
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

function failure(action: () => unknown): FardeskError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(FardeskError);
    return error as FardeskError;
  }
  throw new Error("expected a throw");
}

describe("auth, peers and sessions keys", () => {
  it("default to 5 failures per 300 s, no peers and the old store limits", () => {
    const config = loadConfig(writeConfig({ name: "m", token: TOKEN }));
    expect(config.auth).toEqual({ maxFailures: 5, windowSeconds: 300 });
    expect(config.peers).toEqual([]);
    expect(config.sessions).toEqual({ maxEnded: 200, maxFolders: 20, readsPerPoll: 20, tidyList: true, listEnded: 10, listEndedWithinDays: 24 });
  });

  it("folders.scanRoots defaults to the usual project folders and expands ~ in a configured list", () => {
    const defaults = loadConfig(writeConfig({ name: "m", token: TOKEN })).folders.scanRoots;
    expect(defaults.map((root) => root.dir)).toEqual([join(home, "dev"), join(home, "code"), join(home, "src"), join(home, "projects"), home]);
    const custom = loadConfig(writeConfig({ name: "m", token: TOKEN, folders: { scanRoots: [{ dir: "~/work", depth: 2 }, { dir: "/srv/repos", depth: 1 }] } }));
    expect(custom.folders.scanRoots).toEqual([{ dir: join(home, "work"), depth: 2 }, { dir: "/srv/repos", depth: 1 }]);
    expect(failure(() => loadConfig(writeConfig({ name: "m", token: TOKEN, folders: { scanRoots: [{ dir: "~/x", depth: 0 }] } }))).code).toBe("invalid_request");
  });

  it("accept a partial auth object and reject an invalid peer", () => {
    expect(loadConfig(writeConfig({ name: "m", token: TOKEN, auth: { maxFailures: 9 } })).auth).toEqual({ maxFailures: 9, windowSeconds: 300 });
    expect(failure(() => loadConfig(writeConfig({ name: "m", token: TOKEN, peers: [{ name: "p", url: "ftp://x" }] }))).code).toBe("invalid_request");
  });
});

describe("coordinator key", () => {
  it("defaults to no peer tokens and the default model, and accepts tokens per peer name", () => {
    expect(loadConfig(writeConfig({ name: "m", token: TOKEN })).coordinator).toEqual({ ...CONFIG_DEFAULTS.coordinator, peerTokens: {}, model: null });
    const linked = loadConfig(writeConfig({ name: "m", token: TOKEN, coordinator: { peerTokens: { linux: "t" }, model: "haiku" } }));
    expect(linked.coordinator).toEqual({ ...CONFIG_DEFAULTS.coordinator, peerTokens: { linux: "t" }, model: "haiku" });
    expect(failure(() => loadConfig(writeConfig({ name: "m", token: TOKEN, coordinator: { peerTokens: { linux: "" } } }))).code).toBe("invalid_request");
  });
});

describe("updateConfigFile", () => {
  it("rewrites only the given keys, keeps the rest as written, stays mode 600 and validates", () => {
    const path = writeConfig({ name: "m", token: TOKEN, bind: { address: "tailscale", port: 99 }, extraNote: undefined });
    updateConfigFile(path, { auth: { maxFailures: 7 } });
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(written).toEqual({ name: "m", token: TOKEN, bind: { address: "tailscale", port: 99 }, auth: { maxFailures: 7 } });
    expect(statSync(path).mode & MODE_MASK).toBe(0o600);
    expect(failure(() => { updateConfigFile(path, { colour: "red" }); }).message).toContain("refusing to write invalid config");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(written);
  });

  it("rejects a non-object file", () => {
    expect(failure(() => { updateConfigFile(writeConfig("[1]"), {}); }).message).toContain("must hold a JSON object");
  });
});

describe("expandHome", () => {
  it("expands ~ and ~/x and leaves everything else", () => {
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/x/y")).toBe(join(home, "x/y"));
    expect(expandHome("/abs/~/x")).toBe("/abs/~/x");
    expect(expandHome("~other/x")).toBe("~other/x");
    expect(expandHome("rel")).toBe("rel");
  });
});

describe("defaultConfigPath", () => {
  const saved = process.env["FARDESK_CONFIG"];
  afterEach(() => {
    if (saved === undefined) delete process.env["FARDESK_CONFIG"];
    else process.env["FARDESK_CONFIG"] = saved;
  });

  it("uses FARDESK_CONFIG when set", () => {
    process.env["FARDESK_CONFIG"] = "/custom/config.json";
    expect(defaultConfigPath()).toBe("/custom/config.json");
  });

  it("falls back to ~/.config/fardesk/config.json", () => {
    delete process.env["FARDESK_CONFIG"];
    expect(defaultConfigPath()).toBe(join(home, ".config/fardesk/config.json"));
  });
});

describe("loadConfig", () => {
  it("applies every default for a minimal file and expands home paths", () => {
    const path = writeConfig({ name: "mac", token: TOKEN });
    const config = loadConfig(path);
    expect(config).toEqual({
      ...CONFIG_DEFAULTS,
      name: "mac",
      token: TOKEN,
      claudeHomes: [{ path: join(home, ".claude"), name: ".claude" }],
      stateDir: join(home, ".local/state/fardesk"),
      folders: { scanRoots: CONFIG_DEFAULTS.folders.scanRoots.map((root) => ({ ...root, dir: expandHome(root.dir) })) },
    });
    expect(config.bind).toEqual({ address: "tailscale", port: 4780 });
    expect(config.intervals).toEqual({ registryPollMs: 1000, transcriptPollMs: 500, pingMs: 20000, typablePollMs: 5000 });
    expect(config.models).toEqual(["default", "fable", "opus", "sonnet", "haiku"]);
    expect(config.apns).toBeNull();
  });

  it("expands apns and home paths and keeps explicit values", () => {
    const config = loadConfig(
      writeConfig({
        name: "mac",
        token: TOKEN,
        apns: { keyPath: "~/k.p8", keyId: "K", teamId: "T", topic: "app.id" },
        claudeHomes: ["~/a", "/b"],
        stateDir: "~/state",
        tmuxBinary: "/opt/tmux",
      }),
    );
    expect(config.apns).toEqual({ keyPath: join(home, "k.p8"), keyId: "K", teamId: "T", topic: "app.id" });
    expect(config.claudeHomes).toEqual([{ path: join(home, "a"), name: "a" }, { path: "/b", name: "b" }]);
    expect(config.stateDir).toBe(join(home, "state"));
    expect(config.tmuxBinary).toBe("/opt/tmux");
  });

  it("names a home by its folder when it is a plain path, and by its own name when it is { path, name }", () => {
    const config = loadConfig(writeConfig({ name: "mac", token: TOKEN, claudeHomes: ["~/.claude-team", { path: "~/.claude", name: "private" }] }));
    expect(config.claudeHomes).toEqual([
      { path: join(home, ".claude-team"), name: ".claude-team" },
      { path: join(home, ".claude"), name: "private" },
    ]);
  });

  it("refuses two homes with one name, so the app can filter by name", () => {
    const error = failure(() => loadConfig(writeConfig({ name: "mac", token: TOKEN, claudeHomes: ["/a/.claude", "/b/.claude"] })));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain('two homes are named ".claude"');
    expect(failure(() => loadConfig(writeConfig({ name: "mac", token: TOKEN, claudeHomes: [{ path: "/a", name: "x", extra: 1 }] }))).message).toContain("claudeHomes");
  });

  it("keeps a config with named homes valid when the daemon writes it back", () => {
    const path = writeConfig({ name: "mac", token: TOKEN, claudeHomes: ["/a", { path: "/b", name: "work" }] });
    updateConfigFile(path, { claudeHomes: ["/a", { path: "/b", name: "work" }, "/c"] });
    expect(loadConfig(path).claudeHomes.map((entry) => entry.name)).toEqual(["a", "work", "c"]);
  });

  it("reports a missing file", () => {
    const path = join(makeTempDir(), "nope.json");
    const error = failure(() => loadConfig(path));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain(path);
    expect(error.message).toContain("cannot read");
  });

  it("reports invalid JSON", () => {
    const path = writeConfig("{not json");
    const error = failure(() => loadConfig(path));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("not valid JSON");
    expect(error.message).toContain(path);
  });

  it("names the unknown key", () => {
    const error = failure(() => loadConfig(writeConfig({ name: "mac", token: TOKEN, colour: "red" })));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("colour");
  });

  it("names the unknown key inside a nested object with its path", () => {
    const error = failure(() => loadConfig(writeConfig({ name: "mac", token: TOKEN, bind: { address: "x", port: 1, extra: 1 } })));
    expect(error.message).toContain("extra");
    expect(error.message).toContain("bind");
  });

  it("rejects a short token with the issue path", () => {
    const error = failure(() => loadConfig(writeConfig({ name: "mac", token: "short" })));
    expect(error.code).toBe("invalid_request");
    expect(error.message).toContain("token");
  });

  it("rejects a missing name and a wrong type", () => {
    const error = failure(() => loadConfig(writeConfig({ token: TOKEN, bind: { address: "x", port: "80" } })));
    expect(error.message).toContain("name");
    expect(error.message).toContain("bind.port");
  });

  it("rejects a root that is not an object and an unknown notification", () => {
    expect(failure(() => loadConfig(writeConfig("[]"))).code).toBe("invalid_request");
    const error = failure(() => loadConfig(writeConfig({ name: "m", token: TOKEN, notifications: ["boom"] })));
    expect(error.message).toContain("notifications.0");
  });
});

describe("writeInitialConfig", () => {
  it("creates dirs 700, a 600 file with only name and token, and returns the loaded config", () => {
    const root = makeTempDir();
    const dir = join(root, "a", "b");
    const path = join(dir, "config.json");
    const config = writeInitialConfig(path, "my-mac");
    expect(config.name).toBe("my-mac");
    expect(config.token).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(path).mode & MODE_MASK).toBe(0o600);
    expect(statSync(dir).mode & MODE_MASK).toBe(0o700);
    const written = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(Object.keys(written).sort()).toEqual(["name", "token"]);
    expect(loadConfig(path)).toEqual(config);
  });

  it("generates a different token each time", () => {
    const root = makeTempDir();
    const first = writeInitialConfig(join(root, "1.json"), "m");
    const second = writeInitialConfig(join(root, "2.json"), "m");
    expect(first.token).not.toBe(second.token);
  });

  it("refuses to overwrite an existing file", () => {
    const root = makeTempDir();
    mkdirSync(join(root, "d"));
    const path = join(root, "d", "config.json");
    writeFileSync(path, "keep");
    const error = failure(() => writeInitialConfig(path, "m"));
    expect(error.code).toBe("conflict");
    expect(readFileSync(path, "utf8")).toBe("keep");
  });
});
