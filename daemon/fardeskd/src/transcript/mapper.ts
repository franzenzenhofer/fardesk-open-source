import type { Activity } from "../contract/schema.js";
import type { TranscriptLine } from "./lineTypes.js";
import { buildRows } from "./rows.js";

export type MapOptions = { cwd: string };

// Whole-session mapping: pure and deterministic. Row ids come from the transcript itself (line uuid,
// tool_use id, first member of a merged run), so mapping a longer list keeps the ids of old rows.
export function mapActivities(lines: readonly TranscriptLine[], options: MapOptions): Activity[] {
  return buildRows(lines, options.cwd).map((row) => row.activity);
}
