// Reads an image file the coordinator made or downloaded and proves it is a JPEG or PNG within the size limit.
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { FardeskError } from "../core/errors.js";
import { MAX_IMAGE_BYTES, sniffImageType } from "../service/imageStore.js";
import type { ChatImage } from "./types.js";

const SCALE_HINT = "scale it down first, e.g. `sips -Z 512 <file>` on macOS or `convert -resize 512x512 <file> <out>` with ImageMagick";

export function readImageFile(path: string): ChatImage {
  if (!isAbsolute(path)) throw new FardeskError("invalid_request", "path must be an absolute file path");
  let size: number;
  try {
    const info = statSync(path);
    if (!info.isFile()) throw new FardeskError("invalid_request", `${path} is not a file`);
    size = info.size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new FardeskError("not_found", `no file at ${path}`);
    throw error;
  }
  if (size > MAX_IMAGE_BYTES) throw new FardeskError("invalid_request", `the image is ${Math.round(size / 1000)} KB, the limit is ${Math.round(MAX_IMAGE_BYTES / 1000)} KB: ${SCALE_HINT}`);
  const bytes = new Uint8Array(readFileSync(path));
  const mediaType = sniffImageType(bytes);
  if (mediaType === null) throw new FardeskError("invalid_request", `${path} is not a JPEG or a PNG (checked by its first bytes)`);
  return { mediaType, bytes };
}
