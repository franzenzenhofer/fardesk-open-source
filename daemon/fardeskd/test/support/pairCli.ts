// Starts `fardeskd pair` against a real daemon the way the pair tests need it: real owned services, fast polls.
import { runCli } from "../../src/cli/index.js";
import type { CliDeps } from "../../src/cli/types.js";
import { createRealOwned } from "../../src/service/ownedFactory.js";
import { runWithoutProcesses } from "./cliConfig.js";
import type { CapturedIo } from "./cliConfig.js";

// The pair test kit: everything a `fardeskd pair` test needs, from one import.
export { PAIR_MAX_WRONG } from "../../src/auth/pairCodes.js";
export { captureIo, runWithoutProcesses } from "./cliConfig.js";
export type { CapturedIo } from "./cliConfig.js";
export { startTestDaemon, writeConfigFile } from "./daemon.js";
export type { TestDaemon } from "./daemon.js";
export { waitUntil } from "./env.js";

/** A pairing code of the right length that the daemon never issued. */
export const WRONG_PAIR_CODE = "x".repeat(43);
const FAST_POLL_MS = 50;

export function runPairCli(args: string[], io: CapturedIo, deps: Partial<CliDeps> = {}): Promise<number> {
  return runCli(["pair", ...args], io, { createOwned: createRealOwned, run: runWithoutProcesses, pairPollMs: FAST_POLL_MS, ...deps });
}
