import type { Activity, ActivityPage } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";

export type PageOptions = { before?: string; limit: number };

function endIndex(all: readonly Activity[], before: string | undefined): number {
  if (before === undefined) return all.length;
  const index = all.findIndex((activity) => activity.id === before);
  if (index === -1) throw new FardeskError("invalid_request", `Unknown activity id ${before}`);
  return index;
}

// The newest `limit` rows older than the row `before` (or the newest `limit` rows), oldest first.
export function pageActivities(all: readonly Activity[], options: PageOptions): ActivityPage {
  if (!Number.isInteger(options.limit) || options.limit < 1) {
    throw new FardeskError("invalid_request", `limit must be a positive integer, got ${options.limit}`);
  }
  const end = endIndex(all, options.before);
  const start = Math.max(0, end - options.limit);
  const items = all.slice(start, end);
  const oldestIds = items.slice(0, 1).map((activity) => activity.id);
  return { items, nextBefore: start > 0 ? oldestIds.join("") : null };
}
