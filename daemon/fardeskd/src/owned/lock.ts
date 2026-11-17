import { FardeskError } from "../core/errors.js";
import { sleep } from "../foreign/sleep.js";
import { terminate } from "../foreign/terminate.js";
import { readClaudeRegistry, type LiveProcess } from "../sessions/claudeRegistry.js";
import { isProcessAlive } from "../sessions/processes.js";

export type KillTiming = { timeoutMs: number; pollMs: number };

export function liveHolders(claudeHome: string, sessionId: string): LiveProcess[] {
  return readClaudeRegistry(claudeHome).processes.filter((process) => process.sessionId === sessionId);
}

export async function waitForRelease(claudeHome: string, sessionId: string, kill: KillTiming): Promise<void> {
  const deadline = Date.now() + kill.timeoutMs;
  while (liveHolders(claudeHome, sessionId).length > 0) {
    if (Date.now() >= deadline) throw new FardeskError("conflict", `session ${sessionId} still has a live process`);
    await sleep(kill.pollMs);
  }
}

export async function terminateHolders(holders: LiveProcess[], kill: KillTiming): Promise<void> {
  for (const holder of holders) {
    await terminate({ pid: holder.pid, signal: "SIGTERM", ...kill, isAlive: isProcessAlive });
  }
}
