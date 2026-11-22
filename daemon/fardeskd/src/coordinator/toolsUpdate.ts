// The coordinator tool that updates the whole fleet, and the plain-words report of what happened to each machine.
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { UpdateAllResult } from "../contract/schema.js";
import { answer } from "./toolKit.js";
import type { ToolFactory } from "./toolKit.js";

const RESULT_WORDS = { started: "update started", current: "already current", failed: "NOT updated" } as const;

export function describeUpdate({ source, version, machines }: UpdateAllResult): string {
  const lines = machines.map((entry) => `${entry.name}: ${RESULT_WORDS[entry.result]} (${entry.from === null ? "version unknown" : `was ${entry.from}`}) - ${entry.message}`);
  return [`Newest version in the fleet: ${version}, package taken from ${source}.`, ...lines].join("\n");
}

export const updateMachines: ToolFactory = (backend) =>
  tool(
    "update_machines",
    "Bring every machine (this one and the linked ones) to the newest Fardesk version found among them: the newest machine's release package is installed on each older one, which restarts its daemon when done. Reports per machine whether the update started, the machine was already current, or it failed and why. Updated machines are unreachable for a minute while they restart; check list_sessions afterwards.",
    {},
    async () => answer(async () => describeUpdate(await backend.updateMachines())),
  );
