// The process wiring behind src/main.ts: real output, real signals, the real owned-session runner.
import { endWithParent } from "../core/sandbox.js";
import { createRealOwned } from "../service/ownedFactory.js";
import { runCli } from "./index.js";
import { timestamped } from "./timestamped.js";
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
  // Only the long-running `serve` is a log (timestamps); the other commands print tables, diffs and the pairing link as they are.
  const io: CliIo = {
    stdout: argv[0] === "serve" ? timestamped(console.log, () => new Date()) : console.log,
    stderr: console.error,
    env: source.env,
    untilStop: async () => stopped,
  };
  return runCli(argv, io, { createOwned: createRealOwned });
}
