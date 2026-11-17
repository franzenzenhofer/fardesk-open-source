import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { NewSessionRequest } from "../contract/schema.js";

/** What a caller may add to a new session: extra MCP servers, pre-approved tools, the set of built-in tools, an appended system prompt, a fixed title, a session to resume (the same conversation, but with these extras). */
export type SessionExtras = Pick<Options, "mcpServers" | "allowedTools" | "tools" | "systemPrompt" | "title" | "resume">;

/** An image sent along with a prompt as a content block (base64 data, no data: prefix). */
export type OwnedImage = { mediaType: "image/png" | "image/jpeg"; data: string };

// Sessions that fardeskd runs itself through the Agent SDK. One process owns a session at a time.
export type OwnedRunner = {
  /** Starts a new session and resolves with its session id once Claude Code has reported it. */
  start(request: NewSessionRequest, extras?: SessionExtras): Promise<string>;
  /** Resumes an ended session under fardeskd. Rejects with `conflict` while another process holds it. */
  resume(sessionId: string): Promise<string>;
  /** Ends the terminal process that holds the session, then resumes it under fardeskd. */
  takeover(sessionId: string): Promise<string>;
  /** Branches the session into a new owned session and resolves with the new id. */
  fork(sessionId: string): Promise<string>;
  /** Queues a real user prompt. Rejects with `not_found` when the session is not owned. */
  send(sessionId: string, text: string, images?: OwnedImage[]): void;
  /** Interrupts the running turn. A no-op when no turn is running. */
  interrupt(sessionId: string): Promise<void>;
  /** Types /clear into the owned session and resolves with the new session id (the session is re-keyed to it). */
  clear(sessionId: string): Promise<string>;
  /** Types /compact into the owned session and resolves once Claude Code reports the compact boundary. */
  compact(sessionId: string): Promise<void>;
  /** Ends the owned process. The session stays resumable. */
  stop(sessionId: string): Promise<void>;
  isOwned(sessionId: string): boolean;
  /** True while a turn of that owned session is running. */
  isBusy(sessionId: string): boolean;
  /** Resumes every session that was owned when fardeskd last stopped. */
  restore(): Promise<void>;
  close(): Promise<void>;
};
