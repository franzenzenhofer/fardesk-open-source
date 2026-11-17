import { closeSync, openSync, readdirSync, readSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { errorCode } from "./processes.js";

const TRANSCRIPT_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

export type TranscriptRef = { sessionId: string; path: string; mtimeMs: number; sizeBytes: number; projectDir: string };

function readdirIfPresent(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

function describeFile(projectDir: string, name: string): TranscriptRef | null {
  const match = TRANSCRIPT_FILE.exec(name);
  const sessionId = match?.[1];
  if (sessionId === undefined) return null;
  const path = join(projectDir, name);
  try {
    const stats = statSync(path);
    if (!stats.isFile()) return null;
    return { sessionId, path, mtimeMs: stats.mtimeMs, sizeBytes: stats.size, projectDir };
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function transcriptsInProject(projectDir: string): TranscriptRef[] {
  return readdirIfPresent(projectDir)
    .filter((entry) => !entry.isDirectory())
    .map((entry) => describeFile(projectDir, entry.name))
    .filter((ref): ref is TranscriptRef => ref !== null);
}

export function findTranscripts(claudeHome: string): TranscriptRef[] {
  const projectsDir = join(claudeHome, "projects");
  return readdirIfPresent(projectsDir)
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => transcriptsInProject(join(projectsDir, entry.name)))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function readTranscriptHead(path: string, maxBytes: number): string[] {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    const lastNewline = text.lastIndexOf("\n");
    if (lastNewline < 0) return [];
    return text.slice(0, lastNewline).split("\n");
  } finally {
    closeSync(fd);
  }
}
