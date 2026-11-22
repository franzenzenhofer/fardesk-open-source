// Store dependencies for tests that only need a real store over one real Claude home: nothing owned, pending or muted.
import { basename } from "node:path";
import { createBus } from "../../src/core/bus.js";
import { createLogger } from "../../src/core/log.js";
import { NO_LABEL } from "../../src/service/labelStore.js";
import type { StoreDeps } from "../../src/sessions/store.js";

export function quietStoreDeps(claudeHome: string, overrides: Partial<StoreDeps> = {}): StoreDeps {
  return {
    claudeHomes: [{ path: claudeHome, name: basename(claudeHome) }],
    bus: createBus(),
    log: createLogger(() => undefined, () => new Date()),
    registryPollMs: 60_000,
    transcriptPollMs: 20,
    summaryMaxChars: 80,
    limits: { maxEnded: 10, maxEndedReadsPerRefresh: 10, maxFolders: 5 },
    isOwned: () => false,
    isBusy: () => false,
    pendingKind: () => null,
    isMuted: () => false,
    labelOf: () => NO_LABEL,
    autoColors: { get: () => null, assign: () => undefined },
    onLeftWaiting: () => undefined,
    ...overrides,
  };
}
