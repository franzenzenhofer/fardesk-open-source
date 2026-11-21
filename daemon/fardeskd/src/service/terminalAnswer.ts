// Answers a request that was handed off to the terminal by typing the matching keys into the dialog there.
// Uses the same terminal lookup and typing routes as replies (tmux send-keys, Ghostty AppleScript); the answer counts
// as delivered when the session leaves its "waiting at the computer" state. See "Answering a handed-off request" in DAEMON.md.
import type { Bus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import type { Logger } from "../core/log.js";
import type { PermissionDecision } from "../contract/schema.js";
import type { Broker, HandedOff } from "../permissions/broker.js";
import { permissionKey, questionKey } from "../permissions/terminalKeys.js";
import type { TerminalKey, TerminalReach } from "../permissions/terminalKeys.js";
import { sleep } from "../foreign/sleep.js";
import { sendEnter, sendEscape, sendLiteral } from "../foreign/tmux.js";
import { terminalDeps } from "./actions.js";
import type { ActionDeps } from "./actions.js";
import { locate } from "./terminal.js";
import type { Placement } from "./terminal.js";

/** How long a number key may take to close the dialog before Enter is pressed as well. */
export const KEY_SETTLE_MS = 700;

export type TerminalAnswers = {
  reach(sessionId: string): Promise<TerminalReach>;
  decide(sessionId: string, requestId: string, decision: PermissionDecision): Promise<void>;
  answer(sessionId: string, requestId: string, option: string): Promise<void>;
};

const AT_COMPUTER = "answer it at the computer";

async function placementOf(deps: ActionDeps, sessionId: string): Promise<Placement> {
  const pid = deps.store.find(sessionId)?.process?.pid ?? null;
  return pid === null ? { kind: "none" } : locate(terminalDeps(deps), pid);
}

function reachOf(placement: Placement): TerminalReach {
  if (placement.kind === "pane" || placement.kind === "ghostty") return placement.kind;
  return "none";
}

async function dialogClosed(deps: ActionDeps, sessionId: string, withinMs: number): Promise<boolean> {
  const { pollMs } = deps.config.delivery;
  const deadline = Date.now() + withinMs;
  for (;;) {
    deps.store.refresh();
    if (deps.store.find(sessionId)?.summary.waitingFor !== "terminal") return true;
    if (Date.now() >= deadline) return false;
    await sleep(pollMs);
  }
}

async function pressInPane(deps: ActionDeps, sessionId: string, pane: Extract<Placement, { kind: "pane" }>, key: TerminalKey): Promise<void> {
  const target = { tmuxBinary: deps.config.tmuxBinary, pane: pane.pane, socket: pane.socket, run: deps.run };
  if (key.kind === "escape") {
    await sendEscape(target);
    return;
  }
  await sendLiteral({ ...target, text: key.text });
  // A number key normally selects at once. When the dialog is still open, it wanted Enter as well.
  if (!(await dialogClosed(deps, sessionId, KEY_SETTLE_MS))) await sendEnter(target);
}

async function press(deps: ActionDeps, sessionId: string, key: TerminalKey): Promise<void> {
  const placement = await placementOf(deps, sessionId);
  if (placement.kind === "pane") await pressInPane(deps, sessionId, placement, key);
  else if (placement.kind === "ghostty" && key.kind === "text") await deps.ghostty.type(placement.terminalId, key.text);
  else throw new FardeskError("conflict", `the terminal of session ${sessionId} cannot be typed into: ${AT_COMPUTER}`);
  if (await dialogClosed(deps, sessionId, deps.config.delivery.timeoutMs)) return;
  throw new FardeskError("conflict", `the keys were typed but the dialog of session ${sessionId} is still open: ${AT_COMPUTER}`);
}

function requireTypable(handed: HandedOff, sessionId: string, kind: "question" | "permission"): void {
  if (handed.activity.kind !== kind) throw new FardeskError("invalid_request", `request ${handed.activity.requestId} is a ${handed.activity.kind}, not a ${kind}`);
  if (!handed.typable) throw new FardeskError("conflict", `this dialog of session ${sessionId} cannot be answered from the phone: ${AT_COMPUTER}`);
}

/** When a request is handed off, finds out whether its terminal can be typed into and tells the broker (the activity's `typable`). */
export function watchHandOffs(parts: { bus: Bus; broker: Broker }, answers: TerminalAnswers, log: Logger): () => void {
  return parts.bus.subscribe((event) => {
    if (event.type !== "activity") return;
    const { activity, sessionId } = event;
    if ((activity.kind !== "question" && activity.kind !== "permission") || activity.state !== "terminal" || activity.typable !== undefined) return;
    answers.reach(sessionId).then(
      (reach) => { parts.broker.markReach(sessionId, activity.requestId, reach); },
      (error: unknown) => { log.warn("hand_off_reach_failed", { sessionId, error: error instanceof Error ? error.message : String(error) }); },
    );
  });
}

export function createTerminalAnswers(deps: ActionDeps, broker: Broker): TerminalAnswers {
  return {
    reach: async (sessionId) => reachOf(await placementOf(deps, sessionId)),
    async decide(sessionId, requestId, decision): Promise<void> {
      const handed = broker.handedOff(sessionId, requestId);
      if (handed === null) {
        broker.decide(sessionId, requestId, decision);
        return;
      }
      requireTypable(handed, sessionId, "permission");
      await press(deps, sessionId, permissionKey(decision));
    },
    async answer(sessionId, requestId, option): Promise<void> {
      const handed = broker.handedOff(sessionId, requestId);
      if (handed === null) {
        broker.answer(sessionId, requestId, option);
        return;
      }
      requireTypable(handed, sessionId, "question");
      if (handed.shape?.kind !== "question") throw new FardeskError("conflict", `this question of session ${sessionId} is not a single choice: ${AT_COMPUTER}`);
      await press(deps, sessionId, questionKey(handed.shape, option));
    },
  };
}
