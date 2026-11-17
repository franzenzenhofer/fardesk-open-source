import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { SCAN_CACHE_MS, createFolderSearcher, defaultScanRoots, describeScanRoots, scanFolders } from "./search.js";

function makeHome(): string {
  const home = makeTempDir("fd-folders-");
  const dev = join(home, "dev");
  for (const repo of ["smear-studio", "games/Smear-Lab", "a/b/deep-smear", "a/b/c/too-deep-smear", "node_modules/smear-dep"]) {
    mkdirSync(join(dev, repo, ".git"), { recursive: true });
  }
  mkdirSync(join(dev, "smear-notes"), { recursive: true });
  return home;
}

const NOW = "2026-11-15T10:00:00.000Z";

function searcherFor(home: string, recent: string[], clock: { at: number }): ReturnType<typeof createFolderSearcher> {
  return createFolderSearcher({
    roots: defaultScanRoots(home),
    now: () => clock.at,
    recent: () => ({ folders: recent.map((path) => ({ path, lastUsedAt: NOW })) }),
  });
}

const paths = (home: string, query: string, recent: string[] = [], limit = 20): string[] =>
  searcherFor(home, recent, { at: 0 }).search(query, limit).folders.map((folder) => folder.path);

describe("folder scan stays out of protected and cloud folders", () => {
  it("never lists Desktop, Documents, Downloads or Dropbox/Drive folders, but finds normal ones beside them", () => {
    const home = makeTempDir("fd-folders-");
    for (const name of ["Desktop/inside", "Documents/inside", "Downloads/inside", "Acme Dropbox/inside", "Google Drive/inside", "plain-project/sub"]) {
      mkdirSync(join(home, name), { recursive: true });
    }
    const found = scanFolders([{ dir: home, depth: 2 }]);
    const all = [...found.repos, ...found.plain].map((path) => path.slice(home.length + 1));
    expect(all).toEqual(["plain-project", "plain-project/sub"]);
  });
});

describe("folder search", () => {
  it("finds git repos and plain folders under ~/dev to depth 3, ignores depth 4 and node_modules, matches case-insensitively on the last component", () => {
    const home = makeHome();
    const dev = join(home, "dev");
    expect(paths(home, "SMEAR")).toEqual([
      join(dev, "a/b/deep-smear"),
      join(dev, "games/Smear-Lab"),
      join(dev, "smear-studio"),
      join(dev, "smear-notes"),
    ]);
    expect(paths(home, "games")).toEqual([join(dev, "games")]);
  });

  it("finds a plain folder at depth 2 under home but not at depth 3", () => {
    const home = makeTempDir("fd-folders-");
    mkdirSync(join(home, "fardesk-acceptance", "coord-test", "inner-coord"), { recursive: true });
    expect(paths(home, "coord-test")).toEqual([join(home, "fardesk-acceptance", "coord-test")]);
    expect(paths(home, "inner-coord")).toEqual([]);
  });

  it("skips hidden folders, node_modules, Library and .Trash under home", () => {
    const home = makeTempDir("fd-folders-");
    for (const skipped of [".hidden", "node_modules", "Library", ".Trash"]) {
      mkdirSync(join(home, skipped, "target-inside"), { recursive: true });
    }
    mkdirSync(join(home, "visible", "target-ok"), { recursive: true });
    expect(paths(home, "target")).toEqual([join(home, "visible", "target-ok")]);
    expect(paths(home, "node_modules")).toEqual([]);
    expect(paths(home, "library")).toEqual([]);
  });

  it("ranks recent first, then git repos, then plain folders, lists each once and cuts at the limit", () => {
    const home = makeHome();
    const dev = join(home, "dev");
    mkdirSync(join(home, "plain-smear"), { recursive: true });
    const recent = ["/elsewhere/my-smear", join(dev, "smear-studio"), "/elsewhere/unrelated"];
    const searcher = searcherFor(home, recent, { at: 0 });
    expect(searcher.search("smear", 20).folders.map((folder) => [folder.path, folder.recent])).toEqual([
      ["/elsewhere/my-smear", true],
      [join(dev, "smear-studio"), true],
      [join(dev, "a/b/deep-smear"), false],
      [join(dev, "games/Smear-Lab"), false],
      [join(dev, "smear-notes"), false],
      [join(home, "plain-smear"), false],
    ]);
    expect(searcher.search("smear", 3).folders).toHaveLength(3);
  });

  it("caches the scan for 60 seconds", () => {
    const home = makeHome();
    const clock = { at: 0 };
    const searcher = searcherFor(home, [], clock);
    expect(searcher.search("late", 10).folders).toEqual([]);
    mkdirSync(join(home, "dev", "late-repo", ".git"), { recursive: true });
    clock.at = SCAN_CACHE_MS - 1;
    expect(searcher.search("late", 10).folders).toEqual([]);
    clock.at = SCAN_CACHE_MS;
    expect(searcher.search("late", 10).folders).toEqual([{ path: join(home, "dev", "late-repo"), recent: false }]);
  });

  it("scans the configured roots and names them for the tool description", () => {
    const home = makeTempDir("fd-folders-");
    mkdirSync(join(home, "work", "client-app", ".git"), { recursive: true });
    const searcher = createFolderSearcher({ roots: [{ dir: join(home, "work"), depth: 1 }], now: () => 0, recent: () => ({ folders: [] }) });
    expect(searcher.search("client", 5).folders).toEqual([{ path: join(home, "work", "client-app"), recent: false }]);
    expect(describeScanRoots([{ dir: "~/work", depth: 1 }, { dir: "~", depth: 2 }])).toBe("~/work (1 level), ~ (2 levels)");
    expect(defaultScanRoots("/h").map((root) => root.dir)).toEqual(["/h/dev", "/h/code", "/h/src", "/h/projects", "/h"]);
  });

  it("returns nothing for a home that does not exist", () => {
    expect(paths(join(makeTempDir("fd-folders-"), "missing"), "x")).toEqual([]);
  });
});
