// Which live sessions have a terminal Fardesk can type into (tmux pane or matched Ghostty terminal). Kept as a set the
// session store reads, so such sessions show replyMode "composer" even without an inbox socket.
import { readProcessTable } from "../foreign/processTree.js";
import { listAllPanes, paneOf } from "../foreign/tmux.js";
import type { SessionStore } from "../sessions/store.js";
import { ghosttyPlacement } from "./terminal.js";
import type { TerminalDeps } from "./terminal.js";

export const DENIED_RETRY_MS = 60_000;

export type TypableWatch = { refresh(): Promise<void>; close(): void };

export type TypableOptions = {
  deps: TerminalDeps;
  store: SessionStore;
  typable: Set<number>;
  intervalMs: number;
  now: () => number;
};

async function typablePids(deps: TerminalDeps, pids: number[]): Promise<Set<number>> {
  const table = await readProcessTable(deps.run);
  const panes = await listAllPanes(deps);
  const result = new Set<number>();
  for (const pid of pids) {
    if (paneOf(panes, table, pid) !== null || (await ghosttyPlacement(deps, table, pid, null)) !== null) result.add(pid);
  }
  return result;
}

export function createTypableWatch(options: TypableOptions): TypableWatch {
  const { deps, store, typable } = options;
  let deniedAt: number | null = null;

  const retryDenied = async (): Promise<void> => {
    if (deps.ghostty.status() !== "denied") {
      deniedAt = null;
      return;
    }
    deniedAt ??= options.now();
    if (options.now() - deniedAt < DENIED_RETRY_MS) return;
    deniedAt = options.now();
    await deps.ghostty.probe();
  };

  const refresh = async (): Promise<void> => {
    const live = store.list().filter((session) => session.status !== "ended" && !session.owned && session.pid !== null);
    await retryDenied();
    const next = live.length === 0 ? new Set<number>() : await typablePids(deps, live.map((session) => session.pid ?? 0));
    const changed = live.filter((session) => typable.has(session.pid ?? 0) !== next.has(session.pid ?? 0));
    typable.clear();
    for (const pid of next) typable.add(pid);
    for (const session of changed) store.recompute(session.id);
  };

  const timer = setInterval(() => {
    refresh().catch((error: unknown) => {
      deps.log.warn("typable_refresh_failed", { error: (error as Error).message });
    });
  }, options.intervalMs);
  timer.unref();
  return { refresh, close: (): void => { clearInterval(timer); } };
}
