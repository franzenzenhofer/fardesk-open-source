// The process wiring behind src/main.ts: real output, real signals, the real owned-session runner.
import { endWithParent } from "../core/sandbox.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";
import { readPasswordInput } from "./passwordInput.js";
import type { CliIo } from "./types.js";

const PARENT_CHECK_MS = 2000;

export type SignalSource = { env: NodeJS.ProcessEnv; once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown };

export async function runMain(argv: string[], source: SignalSource): Promise<number> {
  const stopped = new Promise<void>((resolve) => {
    source.once("SIGINT", resolve);
    source.once("SIGTERM", resolve);
    // Only under the test sandbox: a daemon whose test run was killed shuts down like on SIGTERM.
    endWithParent(() => process.ppid, resolve, PARENT_CHECK_MS);
  });
  const io: CliIo = {
    stdout: console.log,
    stderr: console.error,
    env: source.env,
    untilStop: async () => stopped,
    readPassword: async () => readPasswordInput(process.stdin, process.stderr),
  };
  return runCli(argv, io, { createOwned: createRealOwned });
}
