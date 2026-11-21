// Keeps one listener on the right address: waits for Tailscale, rebinds when the tailnet address changes.
import { pauseUnless, untilAddressLost, waitForAddress } from "../config/addressWatch.js";
import type { AddressWatch } from "../config/addressWatch.js";
import { createTailscaleProbe } from "../config/tailscale.js";
import type { RunningServer } from "../server/listen.js";
import type { CommandContext } from "./types.js";

type Open = (address: string) => Promise<RunningServer>;

function watchOf(context: CommandContext, stop: Promise<void>): AddressWatch {
  let stopped = false;
  void stop.then(() => {
    stopped = true;
  });
  const log = (line: string): void => {
    context.io.stdout(line);
  };
  return {
    probe: createTailscaleProbe(context.tailscaleCommands, context.run, log),
    log,
    timing: context.tailnetTiming,
    pause: pauseUnless(stop),
    stopped: (): boolean => stopped,
  };
}

/** `literal` is the already checked bind address, or null when the config says "tailscale". */
export async function serveOnAddresses(context: CommandContext, literal: string | null, open: Open): Promise<void> {
  const stop = context.io.untilStop();
  if (literal !== null) {
    const running = await open(literal);
    await stop;
    await running.close();
    return;
  }
  const watch = watchOf(context, stop);
  for (;;) {
    const address = await waitForAddress(watch);
    if (address === null) return;
    const running = await open(address);
    try {
      await untilAddressLost(address, watch);
    } finally {
      await running.close();
    }
    if (watch.stopped()) return;
  }
}
