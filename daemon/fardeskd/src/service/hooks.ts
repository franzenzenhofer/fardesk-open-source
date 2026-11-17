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
  notifier: Pick<Notifier, "done">;
  log: Logger;
};

async function askBroker(deps: HookHandlerDeps, event: HookEvent): Promise<HookReply> {
  const { toolName, toolInput, cwd } = event;
  if (toolName === undefined || cwd === undefined) {
    deps.log.warn("hook_permission_request_incomplete", { sessionId: event.sessionId });
    return NO_REPLY;
  }
  const handle = deps.broker.ask({ sessionId: event.sessionId, toolName, toolInput, cwd });
  const answer = await handle.answer;
  return { output: toHookOutput(answer, { toolName, toolInput, suggestions: event.permissionSuggestions }) };
}

export function createHookHandler(deps: HookHandlerDeps): (event: HookEvent) => Promise<HookReply> {
  return async (event): Promise<HookReply> => {
    switch (event.hookEventName) {
      case "PermissionRequest":
        return deps.owned.isOwned(event.sessionId) ? NO_REPLY : askBroker(deps, event);
      case "Stop":
        deps.notifier.done({ sessionId: event.sessionId, lastAssistantMessage: event.lastAssistantMessage ?? null });
        return NO_REPLY;
      case "SessionStart":
      case "SessionEnd":
        deps.store.refresh();
        return NO_REPLY;
      default:
        return NO_REPLY;
    }
  };
}
