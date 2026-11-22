import { statSync } from "node:fs";
import type { Options, UserDialogRequest, UserDialogResult } from "@anthropic-ai/claude-agent-sdk";
import { dialogChoices } from "../permissions/dialogs.js";
import type { PermissionMode } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { BYPASS_PERMISSIONS } from "../sessions/permissionMode.js";
import { toSdkResult } from "../permissions/hookReply.js";
import { claudeHomeEnv } from "./claudeEnv.js";
import type { OwnedSet } from "./ownedSet.js";
import { createSession, type RunningSession, type SessionDeps } from "./session.js";
import type { OwnedRunnerDeps } from "./runner.js";

/** Makes Claude Code send system/session_state_changed frames: the authoritative idle signal (see session.ts). */
const SESSION_STATE_ENV = "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS";
const DEFAULT_MODEL = "default";
const SETTING_SOURCES: NonNullable<Options["settingSources"]> = ["user", "project", "local"];

/** `home`: the Claude home folder the process must write into (see claudeHomeEnv). */
export type OpenRequest = { cwd: string; home: string; model: string | null; permissionMode: PermissionMode; extra: Options; knownId: string | null };

/**
 * `bypassPermissions` only works when the SDK is told explicitly that skipping is allowed. Where `owned.allowBypass` is on,
 * every session is told so, because approving a plan may switch a running session into bypassPermissions.
 */
export function permissionOptions(mode: PermissionMode, allowBypass: boolean): Pick<Options, "permissionMode" | "allowDangerouslySkipPermissions"> {
  return mode === BYPASS_PERMISSIONS || allowBypass ? { permissionMode: mode, allowDangerouslySkipPermissions: true } : { permissionMode: mode };
}

function requireDirectory(cwd: string): void {
  if (!statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new FardeskError("invalid_request", `cwd is not an existing directory: ${cwd}`);
  }
}

function modelOption(model: string | null): Pick<Options, "model"> {
  return model === null || model === DEFAULT_MODEL ? {} : { model };
}

const CANCELLED: UserDialogResult = { behavior: "cancelled" };

/** A dialog of Claude Code goes to the phone as it is. Unknown kind, no answer or a withdrawn dialog: Claude Code applies its own default. */
async function askDialog(broker: OwnedRunnerDeps["broker"], sessionId: string, request: UserDialogRequest, signal: AbortSignal): Promise<UserDialogResult> {
  const choices = dialogChoices(request.dialogKind, request.payload);
  if (choices === null || signal.aborted) return CANCELLED;
  const handle = broker.askDialog({ sessionId, dialogKind: request.dialogKind, payload: request.payload, choices });
  const withdraw = (): void => { broker.cancelRequest(sessionId, handle.requestId); };
  signal.addEventListener("abort", withdraw, { once: true });
  const answer = await handle.answer;
  signal.removeEventListener("abort", withdraw);
  return answer.state === "answered" ? { behavior: "completed", result: answer.option } : CANCELLED;
}

export type Opener =(request: OpenRequest) => RunningSession;

export function sessionOptions(deps: OwnedRunnerDeps, { cwd, home, model, permissionMode, extra }: OpenRequest): SessionDeps["options"] {
  return {
    cwd,
    pathToClaudeCodeExecutable: deps.claudeBinary,
    settingSources: SETTING_SOURCES,
    ...permissionOptions(permissionMode, deps.allowBypass),
    includePartialMessages: false,
    env: { ...claudeHomeEnv(home, process.env), [SESSION_STATE_ENV]: "1" },
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
      askDialog: async (sessionId, request, signal) => askDialog(deps.broker, sessionId, request, signal),
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
