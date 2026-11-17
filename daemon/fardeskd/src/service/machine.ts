// Facts about this machine: name, host, OS, daemon version and the installed Claude Code version.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { z } from "zod";
import type { RunCommand } from "../config/bind.js";
import type { Config } from "../config/config.js";
import type { Machine } from "../contract/schema.js";
import { CONTRACT_VERSION } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";

const OS_BY_PLATFORM: Partial<Record<NodeJS.Platform, Machine["os"]>> = { darwin: "macos", linux: "linux" };
const PACKAGE_JSON = new URL("../../package.json", import.meta.url);
const packageSchema = z.looseObject({ version: z.string().min(1) });

export type MachineFacts = Omit<Machine, "sessionsCount" | "ghosttyAutomation">;

export function readDaemonVersion(): string {
  return packageSchema.parse(JSON.parse(readFileSync(PACKAGE_JSON, "utf8"))).version;
}

export function resolveOs(platform: NodeJS.Platform): Machine["os"] {
  const os = OS_BY_PLATFORM[platform];
  if (os === undefined) throw new FardeskError("unsupported", `unsupported platform ${platform}: fardeskd runs on macOS and Linux`);
  return os;
}

// Runs `<claude> --version` once; "2.1.325 (Claude Code)" becomes "2.1.325". Null when it cannot run.
export async function readClaudeVersion(binary: string, run: RunCommand, log: Logger): Promise<string | null> {
  try {
    const token = (await run(binary, ["--version"])).trim().split(/\s/, 1).join("");
    return token === "" ? null : token;
  } catch (error) {
    log.warn("claude_version_unavailable", { binary, error: String(error) });
    return null;
  }
}

export async function collectMachineFacts(config: Config, run: RunCommand, log: Logger): Promise<MachineFacts> {
  return {
    contractVersion: CONTRACT_VERSION,
    name: config.name,
    hostname: hostname(),
    os: resolveOs(process.platform),
    version: readDaemonVersion(),
    claudeVersion: await readClaudeVersion(config.claudeBinary, run, log),
    models: config.models,
    allowBypass: config.owned.allowBypass,
    coordinatorEnabled: config.coordinator.enabled,
  };
}
