// Background work a session started and has not seen finish: a Bash run_in_background, a background agent, a Monitor.
// Claude Code reports "idle" at the end of a turn even while these still run.
import type { TranscriptLine } from "./lineTypes.js";

const TASK_NOTIFICATION = "task-notification";
const LAUNCH_PATTERNS: readonly RegExp[] = [
  /Command running in background with ID: ([\w-]+)/,
  /Async agent launched successfully[\s\S]*?agentId: ([\w-]+)/,
  /Monitor started \(task ([\w-]+)/,
];
const FINISHED_TASK = /<task-id>([\w-]+)<\/task-id>/;

function launchedIds(text: string): string[] {
  return LAUNCH_PATTERNS.flatMap((pattern) => pattern.exec(text)?.[1] ?? []);
}

/** How many background tasks of the (main thread) lines were launched and have no task-notification yet. */
export function countOpenBackgroundTasks(lines: readonly TranscriptLine[]): number {
  const open = new Set<string>();
  for (const line of lines) {
    if (line.type !== "user") continue;
    for (const block of line.blocks) {
      if (line.originKind === TASK_NOTIFICATION && block.type === "text") {
        const finished = FINISHED_TASK.exec(block.text)?.[1];
        if (finished !== undefined) open.delete(finished);
      } else if (block.type === "tool_result") {
        for (const id of launchedIds(block.text)) open.add(id);
      }
    }
  }
  return open.size;
}
