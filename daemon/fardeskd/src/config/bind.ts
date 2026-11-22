import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { FardeskError } from "../core/errors.js";
import type { Config } from "./config.js";
import { TAILSCALE_COMMAND, createTailscaleProbe, describeState } from "./tailscale.js";
import { TAILSCALE_KEYWORD, bindAddressProblem } from "./tailnetOnly.js";

export type RunCommand = (command: string, args: string[]) => Promise<string>;

export type RunWithInput = (command: string, args: string[], input: string) => Promise<string>;

/**
 * Every external tool (ps, tailscale, osascript, tmux, claude) gets a hard deadline. A tool that hangs must never hang
 * the daemon: on 2026-11-21 `ps` hung on processes stuck in uninterruptible sleep, callers without a deadline kept
 * waiting and new calls piled up to the per-user process limit. The deadline rejects on its own clock: a process in
 * uninterruptible sleep ignores even SIGKILL, so waiting for its exit would hang again.
 */
export const COMMAND_TIMEOUT_MS = 20_000;

// `input`, when given, is written to the command's stdin.
function execute(command: string, args: string[], input: string | null, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finish();
    };
    const child = execFile(command, args, (error, stdout, stderr) => {
      settle(() => {
        if (error === null) resolve(stdout);
        else reject(new Error(stderr.trim() || error.message));
      });
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(() => {
        reject(new Error(`${command} did not answer within ${timeoutMs / 1000} s`));
      });
    }, timeoutMs);
    if (input !== null) child.stdin?.end(input);
  });
}

export function createRunCommand(timeoutMs: number): RunCommand {
  return async (command, args) => execute(command, args, null, timeoutMs);
}

export const runCommand: RunCommand = createRunCommand(COMMAND_TIMEOUT_MS);

export async function runCommandWithInput(command: string, args: string[], input: string): Promise<string> {
  return execute(command, args, input, COMMAND_TIMEOUT_MS);
}

export type DetachedJob = { command: string; args: string[]; env: NodeJS.ProcessEnv; logPath: string; onError: (error: Error) => void };

/**
 * The one process without a deadline: the self-update installer restarts the daemon's own service, so it must outlive
 * this process (new session via `detached`, `unref`). Its output goes to `logPath`; `onError` = it could not be started.
 */
export function spawnDetached(job: DetachedJob): void {
  const log = openSync(job.logPath, "a", 0o600);
  const child = spawn(job.command, job.args, { detached: true, stdio: ["ignore", log, log], env: job.env });
  closeSync(log);
  child.once("error", job.onError);
  child.unref();
}

/** The checked literal bind address (a test daemon's loopback), or null when the config says "tailscale" (the address then comes from the tailnet). */
export function literalBindAddress(config: Config): string | null {
  const problem = bindAddressProblem(config.bind.address);
  if (problem !== null) throw new FardeskError("invalid_request", problem);
  return config.bind.address === TAILSCALE_KEYWORD ? null : config.bind.address;
}

export async function resolveBindAddress(config: Config, run: RunCommand, commands: string[] = [TAILSCALE_COMMAND]): Promise<string> {
  const literal = literalBindAddress(config);
  if (literal !== null) return literal;
  const state = await createTailscaleProbe(commands, run, () => undefined)();
  if (state.kind !== "running") throw new FardeskError("conflict", describeState(state));
  return state.address;
}
