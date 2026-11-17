// Config files and a capturing CliIo for the CLI tests.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliIo } from "../../src/cli/types.js";
import { TEST_TOKEN } from "./daemon.js";
import { makeTempDir } from "./env.js";

export type CliConfigOptions = { claudeHome: string; port: number; overrides?: Record<string, unknown> };

export function writeCliConfig({ claudeHome, port, overrides = {} }: CliConfigOptions): { path: string; stateDir: string } {
  const dir = makeTempDir("fdc-");
  const stateDir = join(dir, "state");
  const path = join(dir, "config.json");
  const config = {
    name: "cli-box",
    token: TEST_TOKEN,
    bind: { address: "127.0.0.1", port },
    claudeHomes: [claudeHome],
    stateDir,
    intervals: { registryPollMs: 100, transcriptPollMs: 50, pingMs: 60_000 },
    ...overrides,
  };
  writeFileSync(path, JSON.stringify(config));
  return { path, stateDir };
}

export type CapturedIo = CliIo & { out: string[]; err: string[]; stop(): void };

export function captureIo(env: NodeJS.ProcessEnv = {}, password = ""): CapturedIo {
  const out: string[] = [];
  const err: string[] = [];
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  return {
    out,
    err,
    env,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
    untilStop: async () => stopped,
    readPassword: () => Promise.resolve(password),
    stop: (): void => {
      stop();
    },
  };
}
