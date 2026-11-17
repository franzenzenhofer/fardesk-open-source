// runCli: parse the arguments, run one command, turn errors into exit codes.
import { parseArgs } from "node:util";
import { runCommand } from "../config/bind.js";
import { defaultConfigPath } from "../config/config.js";
import { runAudit } from "./auditCommand.js";
import { runDevices, runRevoke, runRotateToken, runSetPassword } from "./authCommands.js";
import { runCrossSession } from "./crossSession.js";
import { runInit, runPair, runServe, runStatus } from "./commands.js";
import { runHooksCommand } from "./hooks.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "./types.js";
import type { CliDeps, CliIo, CommandContext } from "./types.js";

export const USAGE = [
  "usage: fardeskd <command> [--config <path>]",
  "",
  "commands:",
  "  serve                  run the daemon",
  "  init --name <name>     write the initial config",
  "  install-hooks [--dry-run]  add the Fardesk hooks to every Claude home (--dry-run: print the diff, change nothing)",
  "  uninstall-hooks        remove them again",
  "  pair                   print the pairing link and QR code (one-time code, valid 10 minutes; needs the running daemon)",
  "  rotate-token           replace the master token; device tokens stay valid",
  "  audit [--since <time>] print the audit log (ISO time or 30m, 2h, 7d)",
  "  status                 show config, bind address, daemon and hook state",
  "  set-password           read a new password from stdin, revoke every device token",
  "  devices                list the logged-in devices",
  "  revoke <device|--all>  revoke one device (id or name) or all of them",
  "  cross-session <accept|unset>  set or remove crossSessionInbound in every Claude home settings.json",
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
  "set-password": runSetPassword,
  devices: runDevices,
  revoke: runRevoke,
  "cross-session": runCrossSession,
};

type Parsed = {
  command: string | undefined;
  target: string | undefined;
  config: string | undefined;
  name: string | undefined;
  since: string | undefined;
  all: boolean;
  dryRun: boolean;
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
      help: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  return {
    command: positionals[0],
    target: positionals[1],
    config: values.config,
    name: values.name,
    since: values.since,
    all: values.all === true,
    dryRun: values["dry-run"] === true,
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
    all: parsed.all,
    dryRun: parsed.dryRun,
    since: parsed.since ?? null,
    io,
    deps,
    run: deps.run ?? runCommand,
    now: deps.now ?? ((): Date => new Date()),
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
