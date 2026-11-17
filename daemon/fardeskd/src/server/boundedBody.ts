// Reads a request body into memory with a hard cap: a declared length is required, and the stream is cut off at the cap.
import type { ReadableStreamDefaultReader } from "node:stream/web";
import { FardeskError } from "../core/errors.js";

const BYTES_PER_MB = 1_000_000;

const tooLarge = (maxBytes: number): FardeskError => new FardeskError("invalid_request", `attachment is larger than ${maxBytes / BYTES_PER_MB} MB`);

function declaredLength(request: Request, maxBytes: number): number {
  const header = request.headers.get("content-length");
  const declared = header === null ? Number.NaN : Number(header);
  if (!Number.isInteger(declared) || declared < 0) throw new FardeskError("invalid_request", "the upload needs a content-length header");
  if (declared > maxBytes) throw tooLarge(maxBytes);
  return declared;
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = declaredLength(request, maxBytes);
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > Math.min(declared, maxBytes)) {
      await reader.cancel();
      throw received > maxBytes ? tooLarge(maxBytes) : new FardeskError("invalid_request", "the upload is longer than its content-length");
    }
    chunks.push(value);
  }
  if (received !== declared) throw new FardeskError("invalid_request", "the upload is shorter than its content-length");
  return Buffer.concat(chunks);
}
