// Keeps the latest Tailscale state of this computer for `GET /v1/machine`, read with the probe the address watch uses.
import type { RunCommand } from "../config/bind.js";
import { DEFAULT_TAILNET_TIMING } from "../config/addressWatch.js";
import { createTailscaleProbe } from "../config/tailscale.js";
import type { TailscaleState } from "../config/tailscale.js";
import type { Machine } from "../contract/schema.js";
import type { Logger } from "../core/log.js";

type TailscaleReport = Machine["tailscale"];

const UNKNOWN: TailscaleReport = { state: "unknown" };

export type TailscaleWatch = { current(): TailscaleReport; close(): void };

/** The words the apps show: "unreachable" (no daemon answers) is the same as stopped, a backend still starting is unknown. */
export function reportOf(state: TailscaleState): TailscaleReport {
  switch (state.kind) {
    case "running":
      return { state: "running" };
    case "unreachable":
    case "stopped":
      return { state: "stopped" };
    case "logged-out":
      return { state: "needs-login" };
    case "not-installed":
      return { state: "not-installed" };
    case "no-address":
      return UNKNOWN;
  }
}

export type TailscaleWatchOptions = { commands: string[]; run: RunCommand; log: Logger; pollMs?: number | undefined };

export function startTailscaleWatch({ commands, run, log, pollMs }: TailscaleWatchOptions): TailscaleWatch {
  const probe = createTailscaleProbe(commands, run, (line) => { log.info("tailscale_command", { line }); });
  let report = UNKNOWN;
  let closed = false;
  const refresh = (): void => {
    probe().then(
      (state) => { if (!closed) report = reportOf(state); },
      (error: unknown) => {
        report = UNKNOWN;
        log.warn("tailscale_probe_failed", { error: String(error) });
      },
    );
  };
  refresh();
  const timer = setInterval(refresh, pollMs ?? DEFAULT_TAILNET_TIMING.recheckMs);
  timer.unref();
  return {
    current: (): TailscaleReport => report,
    close(): void {
      closed = true;
      clearInterval(timer);
    },
  };
}
