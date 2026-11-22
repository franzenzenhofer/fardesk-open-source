// The user's chosen picture per chat: one JPEG or PNG file per session in <state dir>/session-images.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FardeskError } from "../core/errors.js";

export const MAX_IMAGE_BYTES = 2_097_152;
const IMAGE_DIR = "session-images";
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const HASH_LENGTH = 16;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export type ImageType = "image/jpeg" | "image/png";
const EXTENSIONS: Readonly<Record<ImageType, string>> = { "image/jpeg": ".jpg", "image/png": ".png" };
const MAGIC: Readonly<Record<ImageType, readonly number[]>> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export type StoredImage = { mediaType: ImageType; bytes: Uint8Array<ArrayBuffer> };

export type ImageStore = {
  /** Replaces the session's image (also one of the other type) and answers the content hash. */
  save(sessionId: string, mediaType: string, bytes: Uint8Array): string;
  /** Removes the session's image file; true when there was one. */
  clear(sessionId: string): boolean;
  /** `not_found` when the session has no image. */
  read(sessionId: string): StoredImage;
};

export const imageHash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH);

function hasMagic(type: ImageType, bytes: Uint8Array): boolean {
  return MAGIC[type].every((byte, index) => bytes[index] === byte);
}

/** The image type that the bytes really are, or null. */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  return (Object.keys(MAGIC) as ImageType[]).find((type) => hasMagic(type, bytes)) ?? null;
}

/** Checks size, declared type and magic bytes; answers the type. Throws `invalid_request` with a plain message. */
export function checkImage(mediaType: string, bytes: Uint8Array): ImageType {
  const declared = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (declared !== "image/jpeg" && declared !== "image/png") throw new FardeskError("invalid_request", "the image must be a JPEG or a PNG");
  if (bytes.byteLength === 0) throw new FardeskError("invalid_request", "the image is empty");
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new FardeskError("invalid_request", `the image is larger than ${MAX_IMAGE_BYTES / 1_000_000} MB: scale it down first`);
  if (!hasMagic(declared, bytes)) throw new FardeskError("invalid_request", `the bytes are not a ${declared === "image/png" ? "PNG" : "JPEG"}`);
  return declared;
}

function removeIfThere(path: string): boolean {
  try {
    unlinkSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function createImageStore(stateDir: string): ImageStore {
  const dir = join(stateDir, IMAGE_DIR);
  const pathOf = (sessionId: string, type: ImageType): string => {
    if (!SAFE_ID.test(sessionId)) throw new FardeskError("invalid_request", "the session id is not valid");
    return join(dir, `${sessionId}${EXTENSIONS[type]}`);
  };
  const clear = (sessionId: string): boolean => (Object.keys(EXTENSIONS) as ImageType[]).map((type) => removeIfThere(pathOf(sessionId, type))).some(Boolean);
  return {
    save(sessionId, mediaType, bytes): string {
      const type = checkImage(mediaType, bytes);
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      clear(sessionId);
      writeFileSync(pathOf(sessionId, type), bytes, { mode: FILE_MODE });
      return imageHash(bytes);
    },
    clear,
    read(sessionId): StoredImage {
      for (const type of Object.keys(EXTENSIONS) as ImageType[]) {
        try {
          const file = readFileSync(pathOf(sessionId, type));
          return { mediaType: type, bytes: new Uint8Array(file) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      throw new FardeskError("not_found", `session ${sessionId} has no image`);
    },
  };
}
