// What a user line means for the phone: a prompt, an interruption, or nothing at all.
import type { ContentBlock, UserLine } from "./lineTypes.js";

// Claude Code's own wrapper around a message that arrives from another session (a reply sent by
// Fardesk into a terminal session). Real example: test/fixtures/transcripts/31-peer-message-wrapper.jsonl.
export const PEER_PREFIX = "Another Claude session sent a message:\n";
export const PEER_SUFFIX_START = "\n\nThis came from another Claude session";
export const PEER_ORIGIN_KIND = "peer";
export const IMAGE_MARKER = "[image]";
export const INTERRUPTED_TEXT = "Interrupted";

const HARNESS_TAGS = [
  "system-reminder",
  "local-command-caveat",
  "local-command-stdout",
  "local-command-stderr",
  "command-message",
  "task-notification",
  "user-prompt-submit-hook",
  "bash-input",
  "bash-stdout",
  "bash-stderr",
];
// A block cut off before its closing tag (a truncated file) is dropped to the end of the text.
const HARNESS_BLOCK = new RegExp(`<(${HARNESS_TAGS.join("|")})(?:\\s[^>]*)?>[\\s\\S]*?(?:</\\1>|$)`, "g");
const COMMAND_NAME = /<command-name>([^<]*)<\/command-name>/;
const COMMAND_ARGS = /<command-args>([^<]*)<\/command-args>/;
const INTERRUPT_MARKER = /^\[Request interrupted by user[^\]]*\]$/;

export type UserRow = { kind: "user" | "system"; text: string };

function slashCommand(text: string): string | null {
  const name = COMMAND_NAME.exec(text)?.[1];
  if (name === undefined) return null;
  const args = COMMAND_ARGS.exec(text)?.[1] ?? "";
  return `${name.trim()} ${args.trim()}`.trim();
}

function visibleText(text: string): string {
  return slashCommand(text) ?? text.replace(HARNESS_BLOCK, "").trim();
}

function unwrapPeer(text: string): string {
  const withoutPrefix = text.startsWith(PEER_PREFIX) ? text.slice(PEER_PREFIX.length) : text;
  const suffixAt = withoutPrefix.indexOf(PEER_SUFFIX_START);
  return suffixAt === -1 ? withoutPrefix : withoutPrefix.slice(0, suffixAt);
}

function partsOf(block: ContentBlock, isPeer: boolean): string[] {
  if (block.type === "image") return [IMAGE_MARKER];
  if (block.type !== "text") return [];
  const text = visibleText(isPeer ? unwrapPeer(block.text) : block.text);
  return text === "" ? [] : [text];
}

export function userRowOf(line: UserLine): UserRow | null {
  const isPeer = line.originKind === PEER_ORIGIN_KIND;
  if ((line.isMeta && !isPeer) || line.isCompactSummary) return null;
  const text = line.blocks.flatMap((block) => partsOf(block, isPeer)).join("\n");
  if (text === "") return null;
  return INTERRUPT_MARKER.test(text) ? { kind: "system", text: INTERRUPTED_TEXT } : { kind: "user", text };
}
