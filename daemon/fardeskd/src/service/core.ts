// Builds the parts of the daemon in dependency order and remembers how to close each of them.
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Config } from "../config/config.js";
import type { PermissionMode } from "../contract/schema.js";
import { knownPermissionMode } from "../sessions/permissionMode.js";
import { createBus } from "../core/bus.js";
import { FardeskError } from "../core/errors.js";
import type { Bus } from "../core/bus.js";
import type { Logger } from "../core/log.js";
import { createHookReceiver } from "../hooks/receiver.js";
import type { OwnedRunner } from "../owned/types.js";
import { createBroker } from "../permissions/broker.js";
import type { Broker } from "../permissions/broker.js";
import type { ApnsClient } from "../push/apns.js";
import { createDeviceStore } from "../push/deviceStore.js";
import type { DeviceStore } from "../push/deviceStore.js";
import { createNotifier } from "../push/notifier.js";
import { createSessionStore } from "../sessions/store.js";
import type { SessionStore } from "../sessions/store.js";
import { apnsFromConfig } from "./apnsSetup.js";
import { createHookHandler } from "./hooks.js";
import { createAutoColourStore } from "../colour/autoColourStore.js";
import { createHiddenStore } from "./hiddenStore.js";
import type { HiddenStore } from "./hiddenStore.js";
import { createLabelStore } from "./labelStore.js";
import type { LabelStore } from "./labelStore.js";
import { createMuteStore } from "./muteStore.js";
import type { MuteStore } from "./muteStore.js";
import { createPauseStore } from "./pauseStore.js";
import type { PauseStore } from "./pauseStore.js";
import type { ServiceOptions } from "./types.js";

export const HOOK_SOCKET_FILE = "hook.sock";
const DEVICES_FILE = "devices.json";
const MUTES_FILE = "mutes.json";
const LABELS_FILE = "labels.json";
const HIDDEN_FILE = "hidden-sessions.json";
const AUTO_COLOURS_FILE = "auto-colours.json";
const PAUSE_FILE = "notification-pause.json";
const MS_PER_SECOND = 1000;
const FALLBACK_TITLE = "Claude Code";

export type Closer = () => void | Promise<void>;

export type Core = {
  bus: Bus;
  broker: Broker;
  owned: OwnedRunner;
  store: SessionStore;
  devices: DeviceStore;
  muteStore: MuteStore;
  labelStore: LabelStore;
  hiddenStore: HiddenStore;
  pauseStore: PauseStore;
  /** Pids of live sessions whose terminal can be typed into; filled by the typable watch. */
  typablePids: Set<number>;
  apns: ApnsClient | null;
  notifier: Notifier;
};

type Notifier = ReturnType<typeof createNotifier>;
type Parts = Omit<Core, "notifier">;

function createStore(config: Config, log: Logger, parts: Pick<Core, "bus" | "broker" | "owned" | "muteStore" | "labelStore" | "typablePids">): SessionStore {
  const { bus, broker, owned, muteStore, labelStore } = parts;
  return createSessionStore({
    claudeHomes: config.claudeHomes,
    bus,
    log,
    registryPollMs: config.intervals.registryPollMs,
    transcriptPollMs: config.intervals.transcriptPollMs,
    summaryMaxChars: config.summaryMaxChars,
    limits: { maxEnded: config.sessions.maxEnded, maxEndedReadsPerRefresh: config.sessions.readsPerPoll, maxFolders: config.sessions.maxFolders },
    isOwned: (id) => owned.isOwned(id),
    isBusy: (id) => owned.isBusy(id),
    pendingKind: (id) => broker.pendingKind(id),
    isMuted: (id) => muteStore.isMuted(id),
    labelOf: (id) => labelStore.get(id),
    autoColors: createAutoColourStore(join(config.stateDir, AUTO_COLOURS_FILE)),
    isTypable: (pid) => parts.typablePids.has(pid),
    onLeftWaiting: (id) => {
      if (!owned.isOwned(id)) broker.cancelSession(id);
    },
    onToolFinished: (id, call) => {
      if (!owned.isOwned(id)) broker.toolFinished(id, call);
    },
  });
}

function resolveApns(config: Config, options: ServiceOptions, closers: Closer[]): ApnsClient | null {
  if (options.apns !== undefined) return options.apns;
  const own = apnsFromConfig(config, Date.now);
  if (own !== null) closers.push(() => { own.close(); });
  return own;
}

function createPushNotifier(setup: { config: Config; log: Logger; doneDelayMs?: number | undefined }, core: Parts): Notifier {
  const { config, log } = setup;
  return createNotifier({
    bus: core.bus,
    apns: core.apns,
    devices: core.devices,
    describe: (id) => core.store.find(id)?.summary ?? { title: FALLBACK_TITLE, summary: "" },
    isMuted: (id) => core.muteStore.isMuted(id),
    notificationsEnabled: config.notifications,
    machineName: config.name,
    content: config.push.content,
    ...(setup.doneDelayMs === undefined ? {} : { doneDelayMs: setup.doneDelayMs }),
    isPaused: () => core.pauseStore.isPaused(),
    isKnown: (id) => core.store.find(id) !== undefined,
    isWorking: (id) => core.store.find(id)?.summary.status === "working",
    stillWaiting: (id, requestId) => core.broker.handedOff(id, requestId) !== null && core.store.find(id)?.summary.status === "waiting",
    log,
  });
}

export function requireHome(sessionId: string, home: string | null): string {
  if (home === null) throw new FardeskError("not_found", `session ${sessionId} is in no configured Claude home`);
  return home;
}

function createPreferenceStores(stateDir: string): Pick<Core, "muteStore" | "labelStore" | "hiddenStore"> {
  return {
    muteStore: createMuteStore(join(stateDir, MUTES_FILE)),
    labelStore: createLabelStore(join(stateDir, LABELS_FILE)),
    hiddenStore: createHiddenStore(join(stateDir, HIDDEN_FILE)),
  };
}

export async function createCore(config: Config, options: ServiceOptions, log: Logger, closers: Closer[]): Promise<Core> {
  const bus = createBus();
  const { muteStore, labelStore, hiddenStore } = createPreferenceStores(config.stateDir);
  const broker = createBroker({ timeoutMs: config.permissionTimeoutSeconds * MS_PER_SECOND, bus, now: () => new Date(), newId: randomUUID, allowBypass: config.owned.allowBypass });
  closers.push(() => { broker.close(); });
  const findCwd = (id: string): string => core.store.get(id).summary.cwd;
  const findHome = (id: string): string => requireHome(id, core.store.get(id).home);
  const findMode = (id: string): PermissionMode | null => knownPermissionMode(core.store.find(id)?.permissionMode ?? null);
  const owned = options.createOwned({ config, broker, log, findCwd, findHome, findMode });
  closers.push(async () => owned.close());
  const typablePids = new Set<number>();
  const store = createStore(config, log, { bus, broker, owned, muteStore, labelStore, typablePids });
  closers.push(() => { store.close(); });
  const devices = createDeviceStore(join(config.stateDir, DEVICES_FILE), () => new Date());
  const parts: Parts = { bus, broker, owned, store, devices, muteStore, labelStore, hiddenStore, pauseStore: createPauseStore(join(config.stateDir, PAUSE_FILE), () => new Date()), typablePids, apns: resolveApns(config, options, closers) };
  const notifier = createPushNotifier({ config, log, doneDelayMs: options.doneDelayMs }, parts);
  const core: Core = { ...parts, notifier };
  closers.push(() => { notifier.close(); });
  const onEvent = createHookHandler({ broker, owned, store, notifier, log });
  const receiver = await createHookReceiver({ socketPath: join(config.stateDir, HOOK_SOCKET_FILE), onEvent, log });
  closers.push(async () => receiver.close());
  // The server must answer while owned sessions come back: one `claude --resume` can take minutes, and on
  // 2026-11-16 that kept a Mac daemon unreachable. A failed restore (e.g. a corrupt state file) is
  // logged as an error; each session that cannot resume is dropped and logged by the runner itself.
  const restoring = owned.restore().then(
    () => { store.refresh(); },
    (error: unknown) => { log.error("owned_restore_failed", { error: error instanceof Error ? error.message : String(error) }); },
  );
  closers.push(async () => restoring);
  store.refresh();
  return core;
}
