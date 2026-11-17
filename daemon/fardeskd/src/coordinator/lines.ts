// One text line per Activity: what the coordinator reads instead of the JSON feed.
import type { Activity } from "../contract/schema.js";
import { cleanForTitle, truncate } from "../transcript/text.js";

export const LINE_MAX_CHARS = 300;

function body(activity: Activity): string {
  switch (activity.kind) {
    case "user":
    case "assistant":
    case "system":
      return activity.text;
    case "tool":
      return `${activity.title} [${activity.status}]`;
    case "files":
      return `${activity.title}: ${activity.changed.join(", ")}`;
    case "question":
      return `${activity.text} (${activity.state}; options: ${activity.options.join(" | ")})`;
    case "permission":
      return `${activity.title} (${activity.state})`;
  }
}

export function activityLine(activity: Activity): string {
  return truncate(cleanForTitle(`${activity.ts} ${activity.kind}: ${body(activity)}`), LINE_MAX_CHARS);
}
