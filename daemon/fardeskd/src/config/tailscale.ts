// Which Tailscale command to use and what state Tailscale is in, read from its own CLI.
import type { RunCommand } from "./bind.js";
import { isTailnetAddress } from "./tailnetAddress.js";

export const TAILSCALE_COMMAND = "tailscale";
/** The command line tool bundled inside the macOS Tailscale app; on a Mac it can reach a daemon the Homebrew one cannot. */
export const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

export type TailscaleState =
  | { kind: "not-installed" }
  | { kind: "unreachable" }
  | { kind: "stopped" }
  | { kind: "logged-out" }
  | { kind: "no-address"; backend: string }
  | { kind: "running"; address: string };

const LOGIN_STATES = new Set(["NeedsLogin", "NeedsMachineAuth"]);

export function tailscaleCommandsFor(platform: string, appCliExists: boolean): string[] {
  return platform === "darwin" && appCliExists ? [TAILSCALE_COMMAND, MAC_APP_CLI] : [TAILSCALE_COMMAND];
}

function backendStateOf(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { BackendState?: unknown };
    return typeof parsed.BackendState === "string" ? parsed.BackendState : "unknown";
  } catch {
    return "unknown";
  }
}

async function addressOf(command: string, run: RunCommand): Promise<string | null> {
  try {
    const address = (await run(command, ["ip", "-4"])).replace(/\n[\s\S]*$/, "").trim();
    return isTailnetAddress(address) ? address : null;
  } catch {
    return null;
  }
}

export async function inspectTailscale(command: string, run: RunCommand): Promise<TailscaleState> {
  let raw: string;
  try {
    raw = await run(command, ["status", "--json"]);
  } catch (error) {
    return (error as Error).message.includes("ENOENT") ? { kind: "not-installed" } : { kind: "unreachable" };
  }
  const backend = backendStateOf(raw);
  if (backend === "Stopped") return { kind: "stopped" };
  if (LOGIN_STATES.has(backend)) return { kind: "logged-out" };
  if (backend !== "Running") return { kind: "no-address", backend };
  const address = await addressOf(command, run);
  return address === null ? { kind: "no-address", backend } : { kind: "running", address };
}

/**
 * Resolves the command once: the first candidate that reaches a Tailscale daemon is kept for good and
 * named in one log line. While none does, the best answer so far (unreachable beats not installed) is returned.
 */
export function createTailscaleProbe(commands: string[], run: RunCommand, log: (line: string) => void): () => Promise<TailscaleState> {
  let chosen: string | null = null;
  return async (): Promise<TailscaleState> => {
    if (chosen !== null) return inspectTailscale(chosen, run);
    let best: TailscaleState = { kind: "not-installed" };
    for (const command of commands) {
      const state = await inspectTailscale(command, run);
      if (state.kind === "not-installed" || state.kind === "unreachable") {
        if (best.kind === "not-installed") best = state;
        continue;
      }
      chosen = command;
      log(`using tailscale command ${command}`);
      return state;
    }
    return best;
  };
}

/** Short form for "waiting for Tailscale: <label>" log lines. */
export function stateLabel(state: TailscaleState): string {
  switch (state.kind) {
    case "not-installed":
      return "not installed";
    case "unreachable":
    case "stopped":
      return "stopped";
    case "logged-out":
      return "logged out";
    case "no-address":
      return `no tailnet address yet (${state.backend})`;
    case "running":
      return "running";
  }
}

/** The plain sentence `fardeskd status` prints. */
export function describeState(state: TailscaleState): string {
  switch (state.kind) {
    case "not-installed":
      return "Tailscale: not installed";
    case "unreachable":
    case "stopped":
      return "Tailscale is stopped on this computer";
    case "logged-out":
      return "Tailscale: logged out, run tailscale up";
    case "no-address":
      return `Tailscale: no tailnet address yet (${state.backend})`;
    case "running":
      return `Tailscale: running, address ${state.address}`;
  }
}
