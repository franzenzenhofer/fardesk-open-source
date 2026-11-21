import { execFile } from "node:child_process";
import { FardeskError } from "../core/errors.js";
import type { Config } from "./config.js";
import { isLoopbackAddress, isTailnetAddress } from "./tailnetAddress.js";
import { TAILSCALE_COMMAND, createTailscaleProbe, describeState } from "./tailscale.js";

export type RunCommand = (command: string, args: string[]) => Promise<string>;

const TAILSCALE_KEYWORD = "tailscale";

export type RunWithInput = (command: string, args: string[], input: string) => Promise<string>;

// `input`, when given, is written to the command's stdin.
async function execute(command: string, args: string[], input: string | null): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, (error, stdout, stderr) => {
      if (error === null) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr.trim() || error.message));
    });
    if (input !== null) child.stdin?.end(input);
  });
}

export async function runCommand(command: string, args: string[]): Promise<string> {
  return execute(command, args, null);
}

export async function runCommandWithInput(command: string, args: string[], input: string): Promise<string> {
  return execute(command, args, input);
}

/** Only the tailnet and loopback are safe for plain-HTTP bearer tokens; anything else needs TLS and an explicit opt-in. */
function requireSafeBind(config: Config): void {
  const { address } = config.bind;
  if (isLoopbackAddress(address) || isTailnetAddress(address)) return;
  if (config.tls !== null && config.bind.allowNonTailnet) return;
  throw new FardeskError(
    "invalid_request",
    `bind.address ${JSON.stringify(address)} is outside the tailnet (100.64.0.0/10) and loopback: bearer tokens and session content would cross that network. Use "tailscale", or set both \`tls\` and \`bind.allowNonTailnet: true\` if you accept the risk.`,
  );
}

/** The checked literal bind address, or null when the config says "tailscale" (the address then comes from the tailnet). */
export function literalBindAddress(config: Config): string | null {
  if (config.bind.address === TAILSCALE_KEYWORD) return null;
  requireSafeBind(config);
  return config.bind.address;
}

export async function resolveBindAddress(config: Config, run: RunCommand, commands: string[] = [TAILSCALE_COMMAND]): Promise<string> {
  const literal = literalBindAddress(config);
  if (literal !== null) return literal;
  const state = await createTailscaleProbe(commands, run, () => undefined)();
  if (state.kind !== "running") throw new FardeskError("conflict", describeState(state));
  return state.address;
}
