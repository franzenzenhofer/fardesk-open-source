import { execFile } from "node:child_process";
import { FardeskError } from "../core/errors.js";
import type { Config } from "./config.js";

export type RunCommand = (command: string, args: string[]) => Promise<string>;

const TAILSCALE_KEYWORD = "tailscale";
const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const MAX_OCTET = 255;
const CGNAT_FIRST_OCTET = 100;
const CGNAT_SECOND_MIN = 64;
const CGNAT_SECOND_MAX = 127;

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

function isTailnetAddress(text: string): boolean {
  const match = IPV4_PATTERN.exec(text);
  if (match === null) return false;
  const octets = match.slice(1).map(Number);
  const [first = 0, second = 0] = octets;
  return (
    octets.every((octet) => octet <= MAX_OCTET) && first === CGNAT_FIRST_OCTET && second >= CGNAT_SECOND_MIN && second <= CGNAT_SECOND_MAX
  );
}

const LOOPBACK_NAMES = new Set(["localhost", "::1"]);
const LOOPBACK_FIRST_OCTET = 127;

function isLoopbackAddress(text: string): boolean {
  if (LOOPBACK_NAMES.has(text)) return true;
  const match = IPV4_PATTERN.exec(text);
  return match !== null && Number(match[1]) === LOOPBACK_FIRST_OCTET;
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

export async function resolveBindAddress(config: Config, run: RunCommand): Promise<string> {
  if (config.bind.address !== TAILSCALE_KEYWORD) {
    requireSafeBind(config);
    return config.bind.address;
  }
  const output = await run(TAILSCALE_KEYWORD, ["ip", "-4"]);
  const address = output.replace(/\n[\s\S]*$/, "").trim();
  if (!isTailnetAddress(address)) {
    throw new FardeskError("internal", `\`tailscale ip -4\` returned ${JSON.stringify(address)}, expected an IPv4 address in 100.64.0.0/10`);
  }
  return address;
}
