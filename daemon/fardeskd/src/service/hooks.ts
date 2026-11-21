// What fardeskd does with the hook events Claude Code posts to its Unix socket.
import type { HookEvent } from "../hooks/payload.js";
import type { HookReply } from "../hooks/receiver.js";
import type { OwnedRunner } from "../owned/types.js";
import type { Broker } from "../permissions/broker.js";
import { toHookOutput } from "../permissions/hookReply.js";
import type { Notifier } from "../push/notifier.js";
import type { SessionStore } from "../sessions/store.js";
import type { Logger } from "../core/log.js";

const NO_REPLY: HookReply = { output: null };

export type HookHandlerDeps = {
  broker: Broker;
  owned: Pick<OwnedRunner, "isOwned">;
  store: Pick<SessionStore, "refresh">;
  notifier: Pick<Notifier, "done" | "handOff">;
  log: Logger;
};

async function askBroker(deps: HookHandlerDeps, event: HookEvent, closed: AbortSignal): Promise<HookReply> {
  const { toolName, toolInput, cwd, sessionId } = event;
  if (toolName === undefined || cwd === undefined) {
    deps.log.warn("hook_permission_request_incomplete", { sessionId });
    return NO_REPLY;
  }
  const handle = deps.broker.ask({ sessionId, toolName, toolInput, cwd });
  const cancel = (): void => { deps.broker.cancelRequest(sessionId, handle.requestId); };
  // The hook connection may already be closed (dialog answered in the terminal): then no listener would ever fire.
  if (closed.aborted) cancel();
  else closed.addEventListener("abort", cancel, { once: true });
  const answer = await handle.answer;
  // The broker gave up waiting: Claude Code now shows its own dialog in the terminal. Say so once.
  if (answer.state === "expired" && answer.timedOut === true) deps.notifier.handOff(sessionId, handle.kind);
  return { output: toHookOutput(answer, { toolName, toolInput, suggestions: event.permissionSuggestions }) };
}

/** The session closed: whatever the phone was asked cannot be answered any more. */
function dropRequests(deps: HookHandlerDeps, sessionId: string): void {
  if (!deps.owned.isOwned(sessionId)) deps.broker.cancelSession(sessionId);
}

export function createHookHandler(deps: HookHandlerDeps): (event: HookEvent, closed: AbortSignal) => Promise<HookReply> {
  return async (event, closed): Promise<HookReply> => {
    switch (event.hookEventName) {
      case "PermissionRequest":
        return deps.owned.isOwned(event.sessionId) ? NO_REPLY : askBroker(deps, event, closed);
      case "Stop":
        deps.notifier.done({ sessionId: event.sessionId, lastAssistantMessage: event.lastAssistantMessage ?? null });
        return NO_REPLY;
      case "SessionEnd":
        dropRequests(deps, event.sessionId);
        deps.store.refresh();
        return NO_REPLY;
      case "SessionStart":
        deps.store.refresh();
        return NO_REPLY;
      default:
        return NO_REPLY;
    }
  };
}
