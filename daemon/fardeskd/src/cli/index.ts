// runCli: parse the arguments, run one command, turn errors into exit codes.
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { DEFAULT_TAILNET_TIMING } from "../config/addressWatch.js";
import { runCommand } from "../config/bind.js";
import { MAC_APP_CLI, tailscaleCommandsFor } from "../config/tailscale.js";
import { defaultConfigPath } from "../config/config.js";
import { runAudit } from "./auditCommand.js";
import { runDevices, runRevoke, runRotateToken } from "./authCommands.js";
import { runCrossSession } from "./crossSession.js";
import { runInit, runServe, runStatus } from "./commands.js";
import { runPair } from "./pairCommand.js";
import { runHomes } from "./homesCommands.js";
import { runHooksCommand } from "./hooks.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CliDeps, CliIo, CommandContext } from "./types.js";

export const USAGE = [
  "usage: fardeskd <command> [--config <path>]",
  "",
  "commands:",
  "  serve                  run the daemon",
  "  init --name <name>     write the initial config (name and token)",
  "  install-hooks [--dry-run]  add the Fardesk hooks to every Claude home (--dry-run: print the diff, change nothing)",
  "  uninstall-hooks        remove them again",
  "  pair                   open a 2 minute pairing window: link + QR code, one device; stays open only while this command runs",
  "  pair --show            same, but the QR code opens as an image on this computer's screen and nothing is printed (for runs by an agent)",
  "  rotate-token           replace the master token; device tokens stay valid",
  "  audit [--since <time>] print the audit log (ISO time or 30m, 2h, 7d)",
  "  status                 show config, bind address, daemon and hook state",
  "  devices                list the logged-in devices",
  "  revoke <device|--all>  revoke one device (id or name) or all of them",
  "  cross-session <accept|unset>  set or remove crossSessionInbound in every Claude home settings.json",
  "  homes [add <path>]     list the Claude homes (configured and found); add one: hooks installed, running daemon reloads",
  "  --help                 this text",
].join("\n");

const COMMANDS: Record<string, (context: CommandContext) => number | Promise<number>> = {
  serve: runServe,
  init: runInit,
  "install-hooks": (context) => runHooksCommand(context, "install"),
  "uninstall-hooks": (context) => runHooksCommand(context, "uninstall"),
  pair: runPair,
  "rotate-token": runRotateToken,
  audit: runAudit,
  status: runStatus,
  devices: runDevices,
  revoke: runRevoke,
  "cross-session": runCrossSession,
  homes: runHomes,
};

type Parsed = {
  command: string | undefined;
  target: string | undefined;
  args: string[];
  config: string | undefined;
  name: string | undefined;
  since: string | undefined;
  all: boolean;
  dryRun: boolean;
  show: boolean;
  help: boolean;
};

function parse(argv: string[]): Parsed {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      config: { type: "string" },
      name: { type: "string" },
      since: { type: "string" },
      all: { type: "boolean" },
      "dry-run": { type: "boolean" },
      show: { type: "boolean" },
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    command: positionals[0],
    target: positionals[1],
    args: positionals.slice(1),
    config: values.config,
    name: values.name,
    since: values.since,
    all: values.all === true,
    dryRun: values["dry-run"] === true,
    show: values.show === true,
    help: values.help === true,
  };
}

function usageError(io: CliIo, message: string): number {
  io.stderr(message);
  io.stderr(USAGE);
  return EXIT_USAGE;
}

function contextOf(parsed: Parsed, io: CliIo, deps: CliDeps): CommandContext {
  return {
    configPath: parsed.config ?? io.env["FARDESK_CONFIG"] ?? defaultConfigPath(),
    name: parsed.name ?? null,
    target: parsed.target ?? null,
    args: parsed.args,
    all: parsed.all,
    dryRun: parsed.dryRun,
    show: parsed.show,
    since: parsed.since ?? null,
    io,
    deps,
    run: deps.run ?? runCommand,
    now: deps.now ?? ((): Date => new Date()),
    tailscaleCommands: deps.tailscaleCommands ?? tailscaleCommandsFor(process.platform, existsSync(MAC_APP_CLI)),
    tailnetTiming: deps.tailnetTiming ?? DEFAULT_TAILNET_TIMING,
  };
}

export async function runCli(argv: string[], io: CliIo, deps: CliDeps): Promise<number> {
  let parsed: Parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    return usageError(io, (error as Error).message);
  }
  if (parsed.help) {
    io.stdout(USAGE);
    return EXIT_OK;
  }
  const handler = parsed.command === undefined ? undefined : COMMANDS[parsed.command];
  if (handler === undefined) return usageError(io, `unknown command: ${parsed.command ?? "(none)"}`);
  try {
    return await handler(contextOf(parsed, io, deps));
  } catch (error) {
    io.stderr(`error: ${(error as Error).message}`);
    return EXIT_FAILURE;
  }
}
