import { statSync } from "node:fs";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { PermissionMode } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { BYPASS_PERMISSIONS } from "../sessions/permissionMode.js";
import { toSdkResult } from "../permissions/hookReply.js";
import { claudeHomeEnv } from "./claudeEnv.js";
import type { OwnedSet } from "./ownedSet.js";
import { createSession, type RunningSession } from "./session.js";
import type { OwnedRunnerDeps } from "./runner.js";

/** Makes Claude Code send system/session_state_changed frames: the authoritative idle signal (see session.ts). */
const SESSION_STATE_ENV = "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS";
const DEFAULT_MODEL = "default";
const SETTING_SOURCES: NonNullable<Options["settingSources"]> = ["user", "project", "local"];

export type OpenRequest = { cwd: string; model: string | null; permissionMode: PermissionMode; extra: Options; knownId: string | null };

/** `bypassPermissions` only works when the SDK is told explicitly that skipping is allowed. */
export function permissionOptions(mode: PermissionMode): Pick<Options, "permissionMode" | "allowDangerouslySkipPermissions"> {
  return mode === BYPASS_PERMISSIONS ? { permissionMode: mode, allowDangerouslySkipPermissions: true } : { permissionMode: mode };
}

function requireDirectory(cwd: string): void {
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new FardeskError("invalid_request", `cwd is not an existing directory: ${cwd}`);
  }
}

function modelOption(model: string | null): Pick<Options, "model"> {
  return model === null || model === DEFAULT_MODEL ? {} : { model };
}

export type Opener = (request: OpenRequest) => RunningSession;

function sessionOptions(deps: OwnedRunnerDeps, { cwd, model, permissionMode, extra }: OpenRequest): Omit<Options, "canUseTool"> {
  return {
    cwd,
    pathToClaudeCodeExecutable: deps.claudeBinary,
    settingSources: SETTING_SOURCES,
    ...permissionOptions(permissionMode),
    includePartialMessages: false,
    env: { ...claudeHomeEnv(deps.claudeHome, process.env), [SESSION_STATE_ENV]: "1" },
    ...modelOption(model),
    ...extra,
  };
}

export function createOpener(deps: OwnedRunnerDeps, owned: OwnedSet): Opener {
  return (request): RunningSession => {
    const { cwd, knownId } = request;
    requireDirectory(cwd);
    const session = createSession({
      sessionId: knownId,
      log: deps.log,
      options: sessionOptions(deps, request),
      askPermission: async (sessionId, toolName, input, suggestions) => {
        const { answer } = deps.broker.ask({ sessionId, toolName, toolInput: input, cwd });
        return toSdkResult(await answer, { toolName, toolInput: input, suggestions });
      },
      onReset: (previousId, newId): void => {
        deps.broker.cancelSession(previousId);
        owned.rekey(previousId, newId);
      },
      onEnd: (): void => {
        const id = session.id();
        if (id === null) return;
        deps.broker.cancelSession(id);
        owned.remove(id);
      },
    });
    return session;
  };
}
