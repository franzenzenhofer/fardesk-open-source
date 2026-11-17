// Pictures and audio sent from the phone: stored on this machine so Claude can Read them by path.
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";
import { attachmentResultSchema } from "../contract/schema.js";
import type { AttachmentResult } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { readJsonState, writeJsonState } from "../core/jsonState.js";

export const MAX_ATTACHMENT_BYTES = 20_000_000;
/** All attachments of one session together. */
export const MAX_SESSION_ATTACHMENT_BYTES = 200_000_000;
export const INDEX_FILE = "attachments-index.json";
const FALLBACK_DIR = "attachments";
const FARDESK_DIR = ".fardesk";
const CWD_DIR = join(FARDESK_DIR, "attachments");
const GITIGNORE_FILE = ".gitignore";
const GITIGNORE_BODY = "*\n";
const MAX_NAME_LENGTH = 80;
const FILE_MODE = 0o600;
const FALLBACK_NAME = "attachment";

export type AttachmentKind = "image" | "audio" | "file";
type MediaInfo = { extension: string; kind: AttachmentKind };
// Every media type not listed below is kept as a plain file under the extension of its own filename.
const OTHER_FILE: MediaInfo = { extension: "", kind: "file" };

const MEDIA_TYPES: Readonly<Record<string, MediaInfo>> = {
  "image/png": { extension: ".png", kind: "image" },
  "image/jpeg": { extension: ".jpg", kind: "image" },
  "image/heic": { extension: ".heic", kind: "image" },
  "audio/m4a": { extension: ".m4a", kind: "audio" },
  "audio/mp4": { extension: ".m4a", kind: "audio" },
  "audio/wav": { extension: ".wav", kind: "audio" },
};

const indexSchema = z.strictObject({ attachments: z.record(z.string(), attachmentResultSchema.extend({ sessionId: z.string().min(1) })) });
type Index = z.infer<typeof indexSchema>;
export type StoredAttachment = AttachmentResult & { sessionId: string };

export type AttachmentStore = {
  save(input: { sessionId: string; cwd: string; mediaType: string; filename: string | null; bytes: Uint8Array }): AttachmentResult;
  /** The stored attachments with these ids; `not_found` when an id is unknown or belongs to another session. */
  resolve(sessionId: string, ids: string[]): StoredAttachment[];
  /** The stored file at exactly this path, uploaded to this session; `not_found` for any other path. */
  readByPath(sessionId: string, path: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> };
};

export function mediaInfo(mediaType: string): MediaInfo {
  return MEDIA_TYPES[mediaType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? OTHER_FILE;
}

export function safeName(filename: string | null, extension: string): string {
  const base = basename((filename ?? "").replaceAll("\\", "/")).replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "");
  const stem = (base.length === 0 ? FALLBACK_NAME : base).slice(0, MAX_NAME_LENGTH);
  return extension === "" || extname(stem).toLowerCase() === extension ? stem : `${stem}${extension}`;
}

const stamp = (now: Date): string => now.toISOString().replace(/[-:.]/g, "");

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function writeUnique(dir: string, name: string, bytes: Uint8Array): string {
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    const path = join(dir, attempt === 0 ? name : `${attempt}-${name}`);
    try {
      writeFileSync(path, bytes, { flag: "wx", mode: FILE_MODE });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

function checkQuota(index: Index, sessionId: string, incoming: number, quota: number): void {
  const used = Object.values(index.attachments).filter((entry) => entry.sessionId === sessionId).reduce((sum, entry) => sum + entry.bytes, 0);
  if (used + incoming > quota) {
    throw new FardeskError("invalid_request", `this session already holds ${used / 1_000_000} MB of attachments, the limit is ${quota / 1_000_000} MB`);
  }
}

export type AttachmentStoreOptions = { stateDir: string; now?: () => Date; sessionQuotaBytes?: number };

function checkUpload(mediaType: string, bytes: Uint8Array): MediaInfo {
  const info = mediaInfo(mediaType);
  if (bytes.byteLength === 0) throw new FardeskError("invalid_request", "attachment is empty");
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new FardeskError("invalid_request", `attachment is larger than ${MAX_ATTACHMENT_BYTES / 1_000_000} MB`);
  return info;
}

// A `*` .gitignore in the .fardesk folder keeps a `git add -A` of the user's project from picking uploads up.
function ensureGitignore(cwd: string): void {
  const dir = join(cwd, FARDESK_DIR);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(join(dir, GITIGNORE_FILE), GITIGNORE_BODY, { flag: "wx", mode: FILE_MODE });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

// In the session's own folder when it is writable, else in the daemon data dir.
function place(stateDir: string, target: { sessionId: string; cwd: string }, fileName: string, bytes: Uint8Array): string {
  if (isDirectory(target.cwd)) {
    try {
      ensureGitignore(target.cwd);
      return writeUnique(join(target.cwd, CWD_DIR), fileName, bytes);
    } catch {
      // the working directory is not writable: fall through to the daemon data dir
    }
  }
  return writeUnique(join(stateDir, FALLBACK_DIR, target.sessionId), fileName, bytes);
}

export function createAttachmentStore(options: AttachmentStoreOptions): AttachmentStore {
  const indexPath = join(options.stateDir, INDEX_FILE);
  const now = options.now ?? ((): Date => new Date());
  const index: Index = readJsonState(indexPath, indexSchema, "attachment index", { attachments: {} });
  return {
    save({ sessionId, cwd, mediaType, filename, bytes }): AttachmentResult {
      const info = checkUpload(mediaType, bytes);
      checkQuota(index, sessionId, bytes.byteLength, options.sessionQuotaBytes ?? MAX_SESSION_ATTACHMENT_BYTES);
      const fileName = `${stamp(now())}-${safeName(filename, info.extension)}`;
      const path = place(options.stateDir, { sessionId, cwd }, fileName, bytes);
      const result: AttachmentResult = { attachmentId: randomUUID(), path, mediaType: mediaType.split(";")[0]?.trim().toLowerCase() ?? mediaType, bytes: bytes.byteLength };
      index.attachments[result.attachmentId] = { ...result, sessionId };
      writeJsonState(indexPath, index);
      return result;
    },
    resolve(sessionId, ids): StoredAttachment[] {
      return ids.map((id) => {
        const found = index.attachments[id];
        if (found?.sessionId !== sessionId) throw new FardeskError("not_found", `attachment ${id} was not uploaded to session ${sessionId}`);
        return found;
      });
    },
    readByPath: (sessionId, path) => readStored(index, sessionId, path),
  };
}

function readStored(index: Index, sessionId: string, path: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> } {
  const found = Object.values(index.attachments).find((entry) => entry.sessionId === sessionId && entry.path === path);
  if (found === undefined) throw new FardeskError("not_found", `no attachment ${path} in session ${sessionId}`);
  try {
    if (!lstatSync(found.path).isFile()) throw new Error("not a regular file");
    return { mediaType: found.mediaType, bytes: readFileSync(found.path) };
  } catch {
    throw new FardeskError("not_found", `attachment ${path} is no longer a regular file on disk`);
  }
}
