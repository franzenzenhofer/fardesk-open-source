// Shared pieces of the coordinator tools: result wrapping and the common arguments.
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FardeskError } from "../core/errors.js";
import type { CoordinatorBackend } from "./types.js";

export type ToolList = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;
type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
export type ToolFactory = (backend: CoordinatorBackend) => ToolList[number];

const text = (value: string): ToolResult => ({ content: [{ type: "text", text: value }] });

/** A failed call becomes a tool error the model can read and report; it is never swallowed. */
export async function answer(work: () => Promise<string>): Promise<ToolResult> {
  try {
    return text(await work());
  } catch (error) {
    if (!(error instanceof FardeskError)) throw error;
    return { ...text(`${error.code}: ${error.message}`), isError: true };
  }
}

export const machine = z.string().min(1).describe("Machine name as listed by list_sessions");
export const sessionId = z.string().min(1).describe("Session id as listed by list_sessions");
