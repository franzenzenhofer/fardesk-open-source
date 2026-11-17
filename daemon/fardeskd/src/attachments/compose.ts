// The text Claude receives for a reply with attachments: the user's words plus one line per file with its path.
import { readFileSync } from "node:fs";
import type { OwnedImage } from "../owned/types.js";
import { mediaInfo, type StoredAttachment } from "./store.js";

/** The Messages API takes images up to 5 MB; larger ones reach Claude by path only. */
export const MAX_IMAGE_BLOCK_BYTES = 5_000_000;
const IMAGE_BLOCK_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg"]);

function label(attachment: StoredAttachment): string {
  return mediaInfo(attachment.mediaType).kind;
}

export function composeText(text: string, attachments: StoredAttachment[]): string {
  if (attachments.length === 0) return text;
  return [text, ...attachments.map((attachment) => `Attached ${label(attachment)}: ${attachment.path}`)].join("\n");
}

export function imageBlocks(attachments: StoredAttachment[]): OwnedImage[] {
  return attachments
    .filter((attachment) => IMAGE_BLOCK_TYPES.has(attachment.mediaType) && attachment.bytes <= MAX_IMAGE_BLOCK_BYTES)
    .map((attachment) => ({
      mediaType: attachment.mediaType as OwnedImage["mediaType"],
      data: readFileSync(attachment.path).toString("base64"),
    }));
}
