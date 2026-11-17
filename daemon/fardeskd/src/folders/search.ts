// Finds folders by name: recently used ones first, then git repos, then plain folders under the scan roots.
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import type { FolderSearch, RecentFolders } from "../contract/schema.js";

export const DEFAULT_FOLDER_LIMIT = 10;
export const MAX_FOLDER_LIMIT = 30;
export const SCAN_CACHE_MS = 10_000;
/**
 * Never opened by the scan. On macOS, the first `readdirSync` of a privacy-protected folder (Desktop,
 * Documents, Downloads, ...) by a launchd daemon shows a permission dialog and blocks the daemon's only
 * thread until someone answers it: in practice a Mac daemon hung for 1.3 h on
 * kTCCServiceSystemPolicyDesktopFolder. Cloud folders can stall the same way while their provider syncs.
 */
const SKIPPED_NAMES: readonly string[] = [
  "node_modules",
  "Library",
  ".Trash",
  "Desktop",
  "Documents",
  "Downloads",
  "Movies",
  "Music",
  "Pictures",
  "Public",
  "Applications",
];
/** Cloud-synced folders (Dropbox, Google Drive, OneDrive, iCloud, Box): matched by name, case-insensitive. */
const CLOUD_FOLDER = /dropbox|google ?drive|onedrive|icloud|cloudstorage|^box$/i;

const isScannable = (name: string): boolean => !name.startsWith(".") && !SKIPPED_NAMES.includes(name) && !CLOUD_FOLDER.test(name);

export const scanRootSchema = z.strictObject({ dir: z.string().min(1), depth: z.number().int().min(1).max(6) });
export type ScanRoot = z.infer<typeof scanRootSchema>;

/** The default `folders.scanRoots` of config.json: the usual project folders three levels deep, the home folder two. */
export const DEFAULT_SCAN_ROOTS: ScanRoot[] = [
  { dir: "~/dev", depth: 3 },
  { dir: "~/code", depth: 3 },
  { dir: "~/src", depth: 3 },
  { dir: "~/projects", depth: 3 },
  { dir: "~", depth: 2 },
];

/** The default roots with `~` replaced by the given home folder. */
export const defaultScanRoots = (home: string): ScanRoot[] =>
  DEFAULT_SCAN_ROOTS.map((root) => ({ ...root, dir: root.dir === "~" ? home : join(home, root.dir.slice(2)) }));

/** The scan roots in words, for the coordinator's tool description: "~/dev, ~/code (three levels), the home folder (two levels)". */
export const describeScanRoots = (roots: ScanRoot[]): string =>
  roots.map((root) => `${root.dir} (${root.depth} ${root.depth === 1 ? "level" : "levels"})`).join(", ");

export type FolderSearchDeps = { recent: () => RecentFolders; roots: ScanRoot[]; now: () => number };
export type FolderSearcher = { search(query: string, limit: number): FolderSearch };
type Scan = { repos: string[]; plain: string[] };

function subfolders(folder: string): string[] {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isScannable(entry.name))
      .map((entry) => join(folder, entry.name));
  } catch {
    return [];
  }
}

function walk(folder: string, depth: number, maxDepth: number, found: Set<string>): void {
  if (depth > maxDepth) return;
  for (const child of subfolders(folder)) {
    found.add(child);
    walk(child, depth + 1, maxDepth, found);
  }
}

export function scanFolders(roots: ScanRoot[]): Scan {
  const found = new Set<string>();
  for (const root of roots) walk(root.dir, 1, root.depth, found);
  const all = [...found].toSorted();
  const isRepo = (path: string): boolean => existsSync(join(path, ".git"));
  return { repos: all.filter(isRepo), plain: all.filter((path) => !isRepo(path)) };
}

export function createFolderSearcher(deps: FolderSearchDeps): FolderSearcher {
  let cache: { at: number; scan: Scan } | null = null;
  const scan = (): Scan => {
    const at = deps.now();
    if (cache === null || at - cache.at >= SCAN_CACHE_MS) cache = { at, scan: scanFolders(deps.roots) };
    return cache.scan;
  };
  return {
    search(query, limit): FolderSearch {
      const needle = query.toLowerCase();
      const matches = (path: string): boolean => basename(path).toLowerCase().includes(needle);
      const recent = deps.recent().folders.map((folder) => folder.path).filter(matches);
      const known = new Set(recent);
      const fresh = (paths: string[]): string[] => paths.filter((path) => matches(path) && !known.has(path));
      const { repos, plain } = scan();
      const folders = [
        ...recent.map((path) => ({ path, recent: true })),
        ...[...fresh(repos), ...fresh(plain)].map((path) => ({ path, recent: false })),
      ];
      return { folders: folders.slice(0, limit) };
    },
  };
}
