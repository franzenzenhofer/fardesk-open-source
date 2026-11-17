// Runs a real hook command line the way Claude Code does: through `sh -c`, payload on stdin.
import { spawn } from "node:child_process";

export type HookRun = { code: number | null; stdout: string; ms: number };

export async function runHook(command: string, stdin: string): Promise<HookRun> {
  const start = performance.now();
  const child = spawn("/bin/sh", ["-c", command], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin);
  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  return { code, stdout, ms: performance.now() - start };
}
