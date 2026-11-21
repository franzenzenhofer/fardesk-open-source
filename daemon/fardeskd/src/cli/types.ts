// What the CLI needs from the outside: output channels, environment, a stop signal and the owned-session factory.
import type { TailnetTiming } from "../config/addressWatch.js";
import type { RunCommand } from "../config/bind.js";
import type { OwnedFactory } from "../service/types.js";

export type CliIo = {
  stdout(line: string): void;
  stderr(line: string): void;
  env: NodeJS.ProcessEnv;
  /** Resolves when the process should stop serving (SIGINT or SIGTERM). */
  untilStop(): Promise<void>;
  /** The new password for `set-password` (stdin: prompted twice on a terminal, one line when piped). */
  readPassword(): Promise<string>;
};

export type CliDeps = {
  createOwned: OwnedFactory;
  run?: RunCommand;
  now?: () => Date;
  /** Tailscale commands to try in order (default: the one on PATH, plus the Mac app's own on macOS). */
  tailscaleCommands?: string[];
  tailnetTiming?: TailnetTiming;
};

export type CommandContext = {
  configPath: string;
  name: string | null;
  target: string | null;
  all: boolean;
  /** The positional arguments after the command name (`homes add <path>`: ["add", "<path>"]). */
  args: readonly string[];
  /** `install-hooks --dry-run`: show what would change, write nothing. */
  dryRun: boolean;
  /** `audit --since`: an ISO time or a span like 30m, 2h, 7d. */
  since: string | null;
  io: CliIo;
  deps: CliDeps;
  run: RunCommand;
  now: () => Date;
  tailscaleCommands: string[];
  tailnetTiming: TailnetTiming;
};

export const EXIT_OK = 0;
export const EXIT_FAILURE = 1;
export const EXIT_USAGE = 2;
