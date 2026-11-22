// `fardeskd pair`: opens the pairing window, shows the link and QR code, and holds the window open until a device
// paired, five wrong codes locked it, the code expired or the command is stopped. The window closes when this ends.
import { PAIR_CODE_TTL_MS, PAIR_MAX_WRONG, pairWindowStatusSchema, windowIdOf } from "../auth/pairCodes.js";
import type { PairWindowStatus } from "../auth/pairCodes.js";
import { resolveBindAddress } from "../config/bind.js";
import { loadConfig } from "../config/config.js";
import { okResultSchema, pairCodeResultSchema } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { buildPairingPayload, pairingLink, renderQr } from "../pairing/index.js";
import { callDaemon } from "./daemonClient.js";
import { requireScreen, showOnScreen } from "./pairScreen.js";
import { EXIT_FAILURE, EXIT_OK } from "./types.js";
import type { CommandContext } from "./types.js";

export const DEFAULT_PAIR_POLL_MS = 1000;
const MS_PER_MINUTE = 60_000;

type Outcome = PairWindowStatus["state"] | "stopped";

/** True when `stop` came first. The timer is cleared either way. */
async function pause(ms: number, stop: Promise<void>): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const elapsed = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => { resolve(false); }, ms);
  });
  try {
    return await Promise.race([elapsed, stop.then(() => true)]);
  } finally {
    clearTimeout(timer);
  }
}

async function askWindow(context: CommandContext, windowId: string): Promise<PairWindowStatus> {
  const status = await callDaemon(context, { method: "GET", path: `/v1/auth/pair-window?window=${windowId}` }, pairWindowStatusSchema);
  if (status.kind === "offline") throw new FardeskError("conflict", `the daemon stopped answering, the pairing window is gone with it (${status.reason})`);
  return status.value;
}

/** Polls (each poll keeps the window open) until the window ends; `stopped` when the command was interrupted first. */
async function holdWindow(context: CommandContext, windowId: string): Promise<{ outcome: Outcome; status: PairWindowStatus | null }> {
  const stop = context.io.untilStop();
  const pollMs = context.deps.pairPollMs ?? DEFAULT_PAIR_POLL_MS;
  for (;;) {
    const status = await askWindow(context, windowId);
    if (status.state !== "open") return { outcome: status.state, status };
    if (await pause(pollMs, stop)) return { outcome: "stopped", status: null };
  }
}

async function closeWindow(context: CommandContext, windowId: string): Promise<void> {
  try {
    const closed = await callDaemon(context, { method: "POST", path: `/v1/auth/pair-window/close?window=${windowId}` }, okResultSchema);
    if (closed.kind === "offline") context.io.stderr(`could not close the pairing window, the daemon is gone and the window with it: ${closed.reason}`);
  } catch (error) {
    context.io.stderr(`could not close the pairing window (it closes by itself within seconds): ${(error as Error).message}`);
  }
}

const REFUSALS: Partial<Record<Outcome, string>> = {
  locked: `pairing window closed: ${PAIR_MAX_WRONG} wrong codes were sent, an audit line was written (see \`fardeskd audit --since 10m\`)`,
  expired: "pairing window closed: the code expired before a device used it",
  abandoned: "pairing window closed: this command stopped asking for it",
  cancelled: "pairing window closed: a newer `fardeskd pair` replaced it",
  closed: "pairing window closed",
  stopped: "pairing window closed: stopped before a device paired",
  none: "pairing window closed: the daemon does not know it",
};

function report(context: CommandContext, outcome: Outcome, status: PairWindowStatus | null): number {
  const paired = status?.paired ?? null;
  if (outcome !== "paired" || paired === null) {
    context.io.stderr(REFUSALS[outcome] ?? `pairing window ended: ${outcome}`);
    return EXIT_FAILURE;
  }
  const from = paired.tailnetDevice === null ? "this computer (no tailnet hop)" : `tailnet device ${paired.tailnetDevice}`;
  context.io.stdout(`paired: ${paired.deviceName}, from ${from}`);
  context.io.stdout(`device id: ${paired.deviceId}`);
  context.io.stdout(`to revoke it: fardeskd revoke ${paired.deviceId} --config ${context.configPath}`);
  context.io.stdout("the pairing window is closed");
  return EXIT_OK;
}

/** Plain mode prints the link and the QR code; `--show` puts the QR code on the screen and prints neither. Returns the cleanup. */
async function presentCode(context: CommandContext, link: string): Promise<() => Promise<void>> {
  if (!context.show) {
    context.io.stdout(link);
    context.io.stdout(await renderQr(link));
    return () => Promise.resolve();
  }
  const screen = await showOnScreen(context, link);
  context.io.stdout(`the pairing code is open on this computer's screen; scan it with the Fardesk app (${PAIR_CODE_TTL_MS / MS_PER_MINUTE} minutes)`);
  return () => screen.close();
}

export async function runPair(context: CommandContext): Promise<number> {
  if (context.show) requireScreen(context);
  const config = loadConfig(context.configPath);
  const address = await resolveBindAddress(config, context.run, context.tailscaleCommands);
  const issued = await callDaemon(context, { method: "POST", path: "/v1/auth/pair-code" }, pairCodeResultSchema);
  if (issued.kind === "offline") throw new FardeskError("conflict", `${issued.reason}; the pairing window lives in the running daemon`);
  const windowId = windowIdOf(issued.value.code);
  const link = pairingLink(buildPairingPayload(config, address, issued.value.code));
  let cleanup: () => Promise<void> = () => Promise.resolve();
  try {
    cleanup = await presentCode(context, link);
    context.io.stdout(`pairing window open until ${issued.value.expiresAt} (${PAIR_CODE_TTL_MS / MS_PER_MINUTE} minutes), one device, ${PAIR_MAX_WRONG} wrong codes close it`);
    context.io.stdout("keep this command running: pairing works only while it does (Ctrl-C closes the window)");
    const { outcome, status } = await holdWindow(context, windowId);
    return report(context, outcome, status);
  } finally {
    await closeWindow(context, windowId);
    await cleanup();
  }
}
