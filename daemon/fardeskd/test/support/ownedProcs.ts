// Real foreign processes and real git repos for the owned-runner tests.
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { waitUntil } from "./env.js";
import { CLAUDE_HOME, TEST_MODEL, transcriptText } from "./owned.js";
import { readClaudeRegistry } from "../../src/sessions/claudeRegistry.js";

const REGISTER_TIMEOUT_MS = 60_000;

export type ForeignProcess = { child: ChildProcess; pid: number; exited: Promise<void> };

export function holderPids(sessionId: string): number[] {
  return readClaudeRegistry(CLAUDE_HOME).processes.filter((p) => p.sessionId === sessionId).map((p) => p.pid);
}

/** A real terminal-style claude process holding the session: stream-json over an open stdin pipe. */
export async function spawnForeign(cwd: string, sessionId: string): Promise<ForeignProcess> {
  const args = ["-p", "--resume", sessionId, "--model", TEST_MODEL, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose"];
  const child = spawn(join(homedir(), ".local", "bin", "claude"), args, { cwd, stdio: ["pipe", "ignore", "ignore"] });
  const exited = new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
  });
  await waitUntil(() => holderPids(sessionId).length > 0, REGISTER_TIMEOUT_MS);
  return { child, pid: child.pid ?? 0, exited };
}

export function assistantTextSince(sessionId: string, fromLine: number): string {
  const lines = transcriptText(sessionId).split("\n").filter((line) => line.length > 0).slice(fromLine);
  return lines.filter((line) => line.includes('"type":"assistant"')).join("\n");
}

export function makeGitRepo(dir: string): void {
  const git = (...args: string[]): void => {
    execFileSync("git", ["-c", "user.name=fardesk-test", "-c", "user.email=test@example.invalid", ...args], { cwd: dir, stdio: "ignore" });
  };
  git("init", "-q");
  writeFileSync(join(dir, "README.md"), "fardesk test repo\n");
  git("add", "README.md");
  git("commit", "-q", "-m", "init");
}
