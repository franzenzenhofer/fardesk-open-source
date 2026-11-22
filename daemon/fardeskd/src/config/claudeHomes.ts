// The Claude homes of a machine: a path and the name the app shows for it.
import { basename } from "node:path";
import { z } from "zod";
import { FardeskError } from "../core/errors.js";

export type ClaudeHomeEntry = { path: string; name: string };

const homeObjectSchema = z.strictObject({ path: z.string().min(1), name: z.string().min(1).max(40) });

/** A plain string is a path; its folder name becomes the home's name. */
export const claudeHomeSchema = z.union([z.string().min(1), homeObjectSchema]).transform(
  (entry): ClaudeHomeEntry => (typeof entry === "string" ? { path: entry, name: basename(entry) } : entry),
);

export const homePaths = (homes: readonly ClaudeHomeEntry[]): string[] => homes.map((home) => home.path);
export const homeNames = (homes: readonly ClaudeHomeEntry[]): string[] => homes.map((home) => home.name);

/** The name of the home at `path`, or null when the path is no configured home. */
export const homeNameOfPath = (homes: readonly ClaudeHomeEntry[], path: string): string | null => homes.find((home) => home.path === path)?.name ?? null;

/** The home called `name`. An unknown name is refused: a session must never silently land in another account. */
export function homeByName(homes: readonly ClaudeHomeEntry[], name: string): ClaudeHomeEntry {
  const found = homes.find((home) => home.name === name);
  if (found === undefined) throw new FardeskError("invalid_request", `unknown home "${name}": this machine has ${homeNames(homes).map((known) => `"${known}"`).join(", ")}`);
  return found;
}

/** Names are what the app filters by, so two homes with one name (two folders both called `.claude`) are refused. */
export function duplicateHomeName(homes: readonly ClaudeHomeEntry[]): string | null {
  const names = homeNames(homes);
  return names.find((name, index) => names.indexOf(name) !== index) ?? null;
}
