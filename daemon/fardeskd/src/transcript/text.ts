// Small pure text helpers shared by titles, mapper, detail and summary.
import { posix } from "node:path";

const ELLIPSIS = "...";

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

export function firstLine(text: string): string {
  return text.trim().replace(/\n[\s\S]*$/, "");
}

// Titles never carry backticks, raw newlines, em or en dashes.
export function cleanForTitle(text: string): string {
  return text
    .replaceAll("`", "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function baseName(path: string): string {
  return posix.basename(path);
}

export function relativeToCwd(path: string, cwd: string): string {
  const prefix = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function dirOf(path: string, cwd: string): string {
  const dir = posix.dirname(relativeToCwd(path, cwd));
  return dir === "." ? "" : dir;
}

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}
