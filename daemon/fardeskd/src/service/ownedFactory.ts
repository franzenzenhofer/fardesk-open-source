// The real owned-session runner (Agent SDK), built from the daemon config.
import { join } from "node:path";
import { FardeskError } from "../core/errors.js";
import { createOwnedRunner } from "../owned/runner.js";
import type { OwnedFactory } from "./types.js";

const OWNED_STATE_FILE = "owned.json";
const CLEAR_TIMEOUT_MS = 30_000;
const COMPACT_TIMEOUT_MS = 180_000;

export const createRealOwned: OwnedFactory = ({ config, broker, log, findCwd, findMode }) => {
  const [claudeHome] = config.claudeHomes;
  if (claudeHome === undefined) throw new FardeskError("invalid_request", "config.claudeHomes is empty: owned sessions need a Claude home");
  return createOwnedRunner({
    claudeBinary: config.claudeBinary,
    claudeHome,
    statePath: join(config.stateDir, OWNED_STATE_FILE),
    permissionMode: config.owned.permissionMode,
    allowBypass: config.owned.allowBypass,
    interruptTimeoutMs: config.owned.interruptTimeoutMs,
    clearTimeoutMs: CLEAR_TIMEOUT_MS,
    compactTimeoutMs: COMPACT_TIMEOUT_MS,
    kill: config.kill,
    broker,
    log,
    findCwd,
    findMode,
  });
};
