// The one facade the server and the CLI talk to.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeviceRegistry, REGISTRY_FILE } from "../auth/deviceRegistry.js";
import { createAuditLog } from "../audit/store.js";
import { createAuthService } from "../auth/service.js";
import type { RunCommand, RunWithInput } from "../config/bind.js";
import { runCommand, runCommandWithInput } from "../config/bind.js";
import type { Config } from "../config/config.js";
import type { ActivityPage, GhosttyAutomation } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { createLogger, stderrSink } from "../core/log.js";
import type { Logger } from "../core/log.js";
import { pagedFeed, sessionDetail } from "../sessions/feed.js";
import { isUnder, visibleSessions } from "../sessions/visible.js";
import type { LocalServices as CoordinatorServices } from "../coordinator/backend.js";
import { COORDINATOR_DIR, createCoordinator } from "../coordinator/session.js";
import { createFolderSearcher } from "../folders/search.js";
import { createAttachmentStore, type AttachmentStore } from "../attachments/store.js";
import { createTelemetryStore } from "../telemetry/store.js";
import { createGhostty, type Ghostty } from "../foreign/ghostty.js";
import { createActions } from "./actions.js";
import { createTypableWatch } from "./typable.js";
import type { TerminalDeps } from "./terminal.js";
import { createCore } from "./core.js";
import type { Closer, Core } from "./core.js";
import { reloadHomes } from "./homes.js";
import { collectMachineFacts } from "./machine.js";
import type { MachineFacts } from "./machine.js";
import type { ActionResult, ServiceOptions, Services } from "./types.js";

const GHOSTTY_CACHE_MS = 3000;
const GHOSTTY_TIMEOUT_MS = 15_000;

type OwnedActions = Pick<Services, "resume" | "takeover" | "fork" | "newSession">;
/** Temp folders of test runs (macOS and Linux); `tmpdir()` is added at runtime. */
const TEMP_ROOTS = ["/tmp", "/private/tmp", "/private/var/folders", "/var/tmp"];

type Reads = Pick<Services, "machine" | "sessions" | "allSessions" | "activity" | "detail" | "recentFolders">;
type Writes = Pick<Services, "decide" | "answer" | "mute" | "label" | "registerDevice">;

async function runClosers(closers: Closer[]): Promise<void> {
  for (const close of closers.toReversed()) await close();
}

function ownedActions({ owned, store }: Core): OwnedActions {
  const afterOwning = async (pending: Promise<string>): Promise<ActionResult> => {
    const sessionId = await pending;
    store.refresh();
    return { sessionId };
  };
  return {
    resume: async (sessionId) => afterOwning(owned.resume(sessionId)),
    takeover: async (sessionId) => afterOwning(owned.takeover(sessionId)),
    fork: async (sessionId) => afterOwning(owned.fork(sessionId)),
    newSession: async (request) => afterOwning(owned.start(request)),
  };
}

const refuseCoordinator = (): Promise<ActionResult> =>
  Promise.reject(new FardeskError("unsupported", "the Coordinator is off on this machine: set coordinator.enabled to true in config.json and restart fardeskd"));

function coordinate(config: Config, { owned, store }: Core, services: CoordinatorServices): Pick<Services, "coordinator" | "coordinatorState"> {
  if (!config.coordinator.enabled) return { coordinator: refuseCoordinator, coordinatorState: () => ({ sessionId: null }) };
  const coordinator = createCoordinator({ config, owned, services });
  return {
    coordinator: async (prompt): Promise<ActionResult> => {
      const sessionId = await coordinator.start(prompt);
      store.refresh();
      return { sessionId };
    },
    coordinatorState: () => ({ sessionId: coordinator.current() }),
  };
}

function reach(config: Config, { store, notifier }: Core): Pick<Services, "searchFolders" | "notifyPhone"> {
  const searcher = createFolderSearcher({ recent: () => store.recentFolders(), roots: config.folders.scanRoots, now: Date.now });
  return {
    searchFolders: (query, limit) => searcher.search(query, limit),
    notifyPhone: async (sessionId, title, body) => notifier.ping(sessionId, title, body),
  };
}

function reads(config: Config, { broker, store }: Core, machine: { facts: MachineFacts; ghostty: Ghostty }): Reads {
  const { tidyList, listEnded, listEndedWithinDays } = config.sessions;
  const hiddenRoots = [...TEMP_ROOTS, tmpdir(), join(config.stateDir, COORDINATOR_DIR)];
  const visible = (): ReturnType<Core["store"]["list"]> =>
    tidyList ? visibleSessions(store.list(), { now: Date.now(), endedWithinDays: listEndedWithinDays, maxEnded: listEnded, hiddenRoots }) : store.list();
  return {
    machine: () => ({ ...machine.facts, sessionsCount: visible().length, ghosttyAutomation: machine.ghostty.status() }),
    sessions: visible,
    allSessions: () => store.list(),
    activity(sessionId, query): ActivityPage {
      const limit = Math.min(query.limit ?? config.activityPageLimit.default, config.activityPageLimit.max);
      return pagedFeed(store, broker, sessionId, query.before === undefined ? { limit } : { before: query.before, limit });
    },
    detail: (sessionId, activityId) => sessionDetail(store, sessionId, activityId, config.detail),
    // The coordinator's own folder and temp folders are no place to start a session: never offered.
    recentFolders: () => ({ folders: store.recentFolders().folders.filter((folder) => !hiddenRoots.some((root) => isUnder(folder.path, root))) }),
  };
}

type TerminalSetup = { config: Config; core: Core; io: { run: RunCommand; runWithInput: RunWithInput; log: Logger }; closers: Closer[] };

/** Ghostty control plus the watch that keeps the set of sessions with a typable terminal current. */
function startTerminals({ config, core, io, closers }: TerminalSetup): Ghostty {
  const ghostty = createGhostty({ stateDir: config.stateDir, osascriptBinary: config.osascriptBinary, run: io.run, log: io.log, cacheMs: GHOSTTY_CACHE_MS, timeoutMs: GHOSTTY_TIMEOUT_MS, now: Date.now });
  const terminal: TerminalDeps = { tmuxBinary: config.tmuxBinary, run: io.run, runWithInput: io.runWithInput, ghostty, log: io.log };
  const watch = createTypableWatch({ deps: terminal, store: core.store, typable: core.typablePids, intervalMs: config.intervals.typablePollMs, now: Date.now });
  watch.refresh().catch((error: unknown) => {
    terminal.log.warn("typable_refresh_failed", { error: (error as Error).message });
  });
  closers.push(() => { watch.close(); });
  return ghostty;
}

function intake(config: Config, { store, pauseStore }: Core, attachments: AttachmentStore): Pick<Services, "saveAttachment" | "readAttachment" | "reportTelemetry" | "telemetry" | "notificationState" | "pauseNotifications"> {
  const telemetry = createTelemetryStore({ dir: config.stateDir });
  return {
    saveAttachment: (sessionId, upload) => attachments.save({ sessionId, cwd: store.get(sessionId).summary.cwd, ...upload }),
    readAttachment: (sessionId, path): ReturnType<AttachmentStore["readByPath"]> => {
      store.get(sessionId);
      return attachments.readByPath(sessionId, path);
    },
    reportTelemetry: (reports) => telemetry.append(reports),
    telemetry: (query) => telemetry.list(query),
    notificationState: () => ({ pausedUntil: pauseStore.pausedUntil() }),
    pauseNotifications: (minutes) => ({ pausedUntil: pauseStore.pause(minutes) }),
  };
}

function writes({ broker, store, devices, muteStore, labelStore }: Core): Writes {
  return {
    decide: (sessionId, requestId, decision): void => {
      broker.decide(sessionId, requestId, decision);
    },
    answer: (sessionId, requestId, option): void => {
      broker.answer(sessionId, requestId, option);
    },
    mute(sessionId, muted): void {
      store.get(sessionId);
      muteStore.set(sessionId, muted);
      store.recompute(sessionId);
    },
    label(sessionId, request): void {
      store.get(sessionId);
      labelStore.patch(sessionId, request);
      store.recompute(sessionId);
    },
    registerDevice: (request): void => {
      devices.upsert(request);
    },
  };
}

export async function createServices(config: Config, options: ServiceOptions): Promise<Services> {
  const log = options.log ?? createLogger(stderrSink, () => new Date());
  const run: RunCommand = options.run ?? runCommand;
  const closers: Closer[] = [];
  try {
    const facts = await collectMachineFacts(config, run, log);
    const core = await createCore(config, options, log, closers);
    const attachments = createAttachmentStore({ stateDir: config.stateDir });
    const runWithInput = options.runWithInput ?? runCommandWithInput;
    const ghostty = startTerminals({ config, core, io: { run, runWithInput, log }, closers });
    const actions = createActions({ config, store: core.store, owned: core.owned, run, runWithInput, attachments, ghostty, log });
    const close = async (): Promise<void> => runClosers(closers);
    const read = reads(config, core, { facts, ghostty });
    const auth = createAuthService({
      config,
      configPath: options.configPath,
      registry: createDeviceRegistry({ path: join(config.stateDir, REGISTRY_FILE), now: () => new Date() }),
      pushDevices: core.devices,
      apns: core.apns,
      machine: read.machine,
      log,
      now: () => Date.now(),
    });
    const base = { ...read, ...actions, ghosttyProbe: async (): Promise<GhosttyAutomation> => ghostty.probe(), ...intake(config, core, attachments), ...ownedActions(core), ...reach(config, core), ...writes(core), reloadHomes: (): { homes: string[] } => reloadHomes(config, options.configPath, core.store) };
    return { bus: core.bus, auth, audit: createAuditLog({ stateDir: config.stateDir }), ...base, ...coordinate(config, core, base), close };
  } catch (error) {
    await runClosers(closers);
    throw error;
  }
}
