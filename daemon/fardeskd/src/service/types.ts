// The facade the HTTP server and the CLI talk to, and what it needs from the outside.
import type { StoredImage } from "./imageStore.js";
import type { RunCommand, RunWithInput } from "../config/bind.js";
import type { Config } from "../config/config.js";
import type { MessageOutcome } from "../foreign/delivery.js";
import type {
  ActivityDetail,
  AttachmentResult,
  ClosedTarget,
  NotificationState,
  TelemetryReport,
  ActivityPage,
  CoordinatorState,
  DeviceRequest,
  FolderSearch,
  GhosttyAutomation,
  HiddenSession,
  LabelRequest,
  Machine,
  PermissionDecision,
  RecentFolders,
  SessionSummary,
  NewSessionRequest,
  PermissionMode,
} from "../contract/schema.js";
import type { AuditLog } from "../audit/store.js";
import type { AuthService } from "../auth/service.js";
import type { Bus } from "../core/bus.js";
import type { Logger } from "../core/log.js";
import type { OwnedRunner } from "../owned/types.js";
import type { Broker } from "../permissions/broker.js";
import type { ApnsClient } from "../push/apns.js";
import type { UpdaterOptions } from "../update/updater.js";

export type OwnedContext = {
  config: Config;
  broker: Broker;
  log: Logger;
  findCwd: (sessionId: string) => string;
  findHome: (sessionId: string) => string;
  findMode: (sessionId: string) => PermissionMode | null;
};
export type OwnedFactory = (context: OwnedContext) => OwnedRunner;

export type ServiceOptions = {
  createOwned: OwnedFactory;
  /** Replaces the APNs client built from `config.apns` (null = never push). */
  apns?: ApnsClient | null;
  /** Quiet period before a "done" push (default 20 s); tests shorten it. */
  doneDelayMs?: number;
  run?: RunCommand;
  /** Tailscale commands to try for `whois` on a pairing request (default: `tailscale`, plus the macOS app's CLI). */
  tailscaleCommands?: string[];
  /** How often the Tailscale state in `GET /v1/machine` is read again (default 30 s); tests shorten it. */
  tailscalePollMs?: number;
  /** How long a `whois` answer is trusted (default 60 s); tests shorten it. */
  whoisCacheMs?: number;
  runWithInput?: RunWithInput;
  log?: Logger;
  /** The config file this daemon was started from: where a master-token rotation is written. */
  configPath: string;
  /** Replaces the daemon's own version number; tests run a fleet of different versions. */
  version?: string;
  /** Self-update settings; tests inject the installer and the install folder. */
  update?: Partial<Pick<UpdaterOptions, "installDir" | "installer" | "now" | "staleMs">>;
};

export type ActionResult = { sessionId: string };
export type AttachmentUpload = { mediaType: string; filename: string | null; bytes: Uint8Array };
export type TelemetryQuery = { since?: string | undefined; limit?: number | undefined; kind?: "error" | "event" | undefined };
export type ActivityQuery = { before?: string | undefined; limit?: number | undefined };

/** The answers to what a session waits for: a permission, a question, a Claude Code dialog. */
export type RequestAnswers = {
  /** Allow or deny a request. After a hand-off to the terminal this types the matching key into the dialog (typable ones only). */
  decide(sessionId: string, requestId: string, decision: PermissionDecision, message?: string): Promise<void>;
  /** Answers a question. After a hand-off to the terminal this types the option number into the dialog (single choice only). */
  answer(sessionId: string, requestId: string, option: string): Promise<void>;
  /** Answers a Claude Code dialog with one of its choices. */
  answerDialog(sessionId: string, requestId: string, answer: string): Promise<void>;
};

export type Services = RequestAnswers & {
  bus: Bus;
  auth: AuthService;
  audit: AuditLog;
  machine(): Machine;
  /** What clients see: live sessions and the recent ended ones (sessions/visible.ts). */
  sessions(): SessionSummary[];
  /** Every session the store knows, also old and test ones: for the coordinator's search. */
  allSessions(): SessionSummary[];
  activity(sessionId: string, query: ActivityQuery): ActivityPage;
  detail(sessionId: string, activityId: string): ActivityDetail;
  recentFolders(): RecentFolders;
  /** Recently used folders and git repos whose name contains the query, at most `limit`. */
  searchFolders(query: string, limit: number): FolderSearch;
  /** Pushes a "done" notification that opens `sessionId` to every registered device; resolves to how many accepted it. */
  notifyPhone(sessionId: string, title: string, body: string): Promise<number>;
  message(sessionId: string, text: string, attachmentIds?: string[]): Promise<MessageOutcome>;
  stop(sessionId: string): Promise<void>;
  kill(sessionId: string, closeTab?: boolean): Promise<ClosedTarget>;
  /** Stores an uploaded picture or audio file for the session on this machine. */
  saveAttachment(sessionId: string, upload: AttachmentUpload): AttachmentResult;
  /** The stored bytes of an attachment of this session, found by its exact stored path. */
  readAttachment(sessionId: string, path: string): { mediaType: string; bytes: Uint8Array<ArrayBuffer> };
  /** Stores the chat image (JPEG or PNG, at most 2 MB, magic bytes checked) and answers its hash. */
  setSessionImage(sessionId: string, upload: { mediaType: string; bytes: Uint8Array }): string;
  clearSessionImage(sessionId: string): void;
  /** `not_found` when the session has no image. */
  readSessionImage(sessionId: string): StoredImage;
  reportTelemetry(reports: TelemetryReport[]): { accepted: number; duplicates: number };
  telemetry(query: TelemetryQuery): TelemetryReport[];
  notificationState(): NotificationState;
  /** Pauses every push of this machine for `minutes` (0 = resume). */
  pauseNotifications(minutes: number): NotificationState;
  resume(sessionId: string): Promise<ActionResult>;
  takeover(sessionId: string): Promise<ActionResult>;
  fork(sessionId: string): Promise<ActionResult>;
  /** Types /clear into the session. Resolves with the id of the session that continues in its place (owned: re-keyed; terminal: the new registry id). */
  clear(sessionId: string): Promise<ActionResult>;
  /** Types /compact into the session and resolves when it is done (owned) or typed (terminal). The id stays; an ended session is resumed as owned first. */
  compact(sessionId: string): Promise<ActionResult>;
  newSession(request: NewSessionRequest): Promise<ActionResult>;
  /** Starts the coordinator session, or sends the prompt to the one that is running. */
  coordinator(prompt: string): Promise<ActionResult>;
  coordinatorState(): CoordinatorState;
  /** Lists Ghostty terminals once so macOS asks for the Automation consent; answers the resulting status. */
  ghosttyProbe(): Promise<GhosttyAutomation>;
  /** Stopped sessions the user removed from the list, so Settings can bring them back. */
  hiddenSessions(): HiddenSession[];
  /** Removes a stopped session from the list (`conflict` when it is not stopped) or brings it back. A session that runs again is listed again. */
  hide(sessionId: string, hidden: boolean): void;
  mute(sessionId: string, muted: boolean): void;
  label(sessionId: string, request: LabelRequest): void;
  registerDevice(request: DeviceRequest): void;
  /** Re-reads claudeHomes from the config file: sessions of an added home show up without a restart. */
  reloadHomes(): { homes: string[] };
  /** The release package this machine is installed from (GET /v1/update/package); `not_found` when it has none. */
  updatePackage(): Buffer<ArrayBuffer>;
  /** Installs a release package in the background (POST /v1/machine/update): `invalid_request` for a bad hash or package, `conflict` while an update runs. */
  startUpdate(bytes: Uint8Array, sha256: string): Promise<void>;
  close(): Promise<void>;
};
