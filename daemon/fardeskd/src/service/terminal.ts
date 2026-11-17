// Where a terminal session lives (tmux pane, Ghostty terminal or a plain terminal tab) and what ending it may close.
// One snapshot of the process table per call. Delivery order for replies: tmux send-keys, Ghostty AppleScript, inbox.
import type { RunCommand, RunWithInput } from "../config/bind.js";
import type { ClosedTarget } from "../contract/schema.js";
import type { Ghostty } from "../foreign/ghostty.js";
import type { Logger } from "../core/log.js";
import { readProcessTable } from "../foreign/processTree.js";
import type { ProcessTable } from "../foreign/processTree.js";
import { findTabShell } from "../foreign/terminalTab.js";
import { killPane, listAllPanes, paneExists, paneOf, sendText } from "../foreign/tmux.js";

export type TerminalDeps = { tmuxBinary: string; run: RunCommand; runWithInput: RunWithInput; ghostty: Ghostty; log: Logger };

export type Placement =
  | { kind: "pane"; pane: string; socket: string | null }
  | { kind: "ghostty"; terminalId: string; shellPid: number | null }
  | { kind: "tab"; shellPid: number }
  | { kind: "none" };

export async function ghosttyPlacement(deps: TerminalDeps, table: ProcessTable, pid: number, shellPid: number | null): Promise<Placement | null> {
  if (!deps.ghostty.hosts(table, pid) || deps.ghostty.status() === "denied") return null;
  try {
    const terminal = await deps.ghostty.find(table, pid);
    return terminal === null ? null : { kind: "ghostty", terminalId: terminal.id, shellPid };
  } catch (error) {
    deps.log.warn("ghostty_unavailable", { pid, error: (error as Error).message });
    return null;
  }
}

/** Looks for the tmux pane that holds `pid`, else its Ghostty terminal, else a terminal tab whose shell is its direct parent. Never anything but the process's own ancestors or terminal. */
export async function locate(deps: TerminalDeps, pid: number): Promise<Placement> {
  const table = await readProcessTable(deps.run);
  const pane = paneOf(await listAllPanes(deps), table, pid);
  if (pane !== null) return { kind: "pane", pane: pane.pane, socket: pane.socket };
  const shell = findTabShell(table, pid);
  const ghostty = await ghosttyPlacement(deps, table, pid, shell?.pid ?? null);
  if (ghostty !== null) return ghostty;
  return shell === null ? { kind: "none" } : { kind: "tab", shellPid: shell.pid };
}

export async function typeIntoPane(deps: TerminalDeps, placement: { pane: string; socket: string | null }, text: string): Promise<void> {
  await sendText({ tmuxBinary: deps.tmuxBinary, pane: placement.pane, socket: placement.socket, run: deps.run, runWithInput: deps.runWithInput, text });
}

function hangUp(pid: number): void {
  try {
    process.kill(pid, "SIGHUP");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function closeGhostty(deps: TerminalDeps, placement: { terminalId: string; shellPid: number | null }): Promise<ClosedTarget> {
  try {
    await deps.ghostty.close(placement.terminalId);
    return "tab";
  } catch (error) {
    deps.log.warn("ghostty_close_failed", { terminalId: placement.terminalId, error: (error as Error).message });
    if (placement.shellPid === null) return "none";
    hangUp(placement.shellPid);
    return "tab";
  }
}

/** Called after the session's process has ended: closes what `locate` found. A pane that already vanished counts as closed. */
export async function closePlacement(deps: TerminalDeps, placement: Placement): Promise<ClosedTarget> {
  if (placement.kind === "pane") {
    const target = { tmuxBinary: deps.tmuxBinary, pane: placement.pane, socket: placement.socket, run: deps.run };
    if (await paneExists(target)) await killPane(target);
    return "pane";
  }
  if (placement.kind === "ghostty") return closeGhostty(deps, placement);
  if (placement.kind === "tab") {
    hangUp(placement.shellPid);
    return "tab";
  }
  return "none";
}
