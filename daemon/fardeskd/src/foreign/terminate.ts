import { FardeskError } from "../core/errors.js";
import { sleep } from "./sleep.js";

export type TerminateOptions = {
  pid: number;
  signal: NodeJS.Signals;
  timeoutMs: number;
  pollMs: number;
  isAlive: (pid: number) => boolean;
};

export async function terminate(options: TerminateOptions): Promise<void> {
  const { pid, signal, timeoutMs, pollMs, isAlive } = options;
  if (!isAlive(pid)) return;
  process.kill(pid, signal);
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) throw new FardeskError("conflict", `process ${pid} did not exit`);
    await sleep(pollMs);
  }
}
