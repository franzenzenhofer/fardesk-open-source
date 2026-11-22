// Single source of truth for everything that crosses the wire between fardeskd and its clients.
// JSON Schema files in schema/ and the golden fixtures in schema/fixtures/ are generated from here.
import { z } from "zod";
import { COLOR_PATTERN, PALETTE_SIZE } from "./palette.js";

export const CONTRACT_VERSION = 4;

export const sessionStatusSchema = z.enum(["working", "waiting", "idle", "ended"]);
/**
 * What a waiting session needs. "permission" and "question": the daemon holds a request the phone can answer.
 * "terminal": a dialog is open at the computer and the daemon holds no request for it, so only the terminal can answer.
 */
export const waitingReasonSchema = z.enum(["permission", "question", "terminal", "dialog"]);
/** Which coding agent runs the session. Every session is "claude" until Codex sessions are read. */
export const agentSchema = z.enum(["claude", "codex"]);
export const replyModeSchema = z.enum(["composer", "takeover", "resume"]);
export const toolStatusSchema = z.enum(["running", "ok", "error"]);
/** "terminal": the phone was not asked in time and the dialog now waits at the computer (see `typable`). */
export const permissionStateSchema = z.enum(["pending", "allowed", "denied", "expired", "terminal"]);
export const questionStateSchema = z.enum(["pending", "answered", "expired", "terminal"]);
/** A dialog is never handed off to a terminal: it ends answered, or expired when Claude Code withdraws it. */
export const dialogStateSchema = z.enum(["pending", "answered", "expired"]);
/** The decisions only a plan request ("Ready to code?", tool ExitPlanMode) takes, as in Claude Code's terminal prompt. */
export const planChoiceSchema = z.enum(["approve_bypass", "approve_manual", "revise"]);
export const permissionDecisionSchema = z.enum(["allow", "deny", "allow_always", ...planChoiceSchema.options]);
export const machineOsSchema = z.enum(["macos", "linux"]);
/** Whether the daemon may drive Ghostty through AppleScript (macOS Automation consent): "unknown" until it tried. */
export const ghosttyAutomationSchema = z.enum(["ok", "denied", "unknown"]);
export const apnsEnvironmentSchema = z.enum(["sandbox", "production"]);
export const notificationTypeSchema = z.enum(["done", "permission", "question", "ended"]);
/** Claude Code permission modes (Agent SDK `PermissionMode`). Fardesk starts sessions in `bypassPermissions` unless told otherwise. */
export const permissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "auto"]);

const isoTimestamp = z.iso.datetime();

/** A label colour is `#RRGGBB`, upper case. The 64 presets are in palette.ts; any other colour is the user's own pick. */
export const labelColorSchema = z.string().regex(COLOR_PATTERN);
/** The preset palette, in picker order (hue order). The fixture carries the values; the app's table must equal it. */
export const labelPaletteSchema = z.array(z.object({ name: z.string().min(1), color: labelColorSchema })).length(PALETTE_SIZE);
/** The user's own name, colour and pin for a session; `name: null` means the app shows `title`. */
/** `image` is the first 16 hex characters of the sha256 of the stored chat image, or null when the chat has none. */
export const IMAGE_HASH_PATTERN = /^[0-9a-f]{16}$/;
export const sessionLabelSchema = z.object({ name: z.string().min(1).max(80).nullable(), color: labelColorSchema.nullable(), pinned: z.boolean(), image: z.string().regex(IMAGE_HASH_PATTERN).nullable() });

/** What Tailscale does on this computer, read live: the reason a machine cannot be reached by its phone. */
export const tailscaleStateSchema = z.enum(["running", "stopped", "needs-login", "not-installed", "unknown"]);

export const updateStateSchema = z.enum(["idle", "running", "failed", "done"]);
/**
 * The last self-update of this machine. `version` = the version of that update's package, `message` = why it failed (last
 * installer log line) and `at` = when the state last changed; all null while `idle`. `packageSha256` = SHA-256 of this
 * machine's own installed release package (what `GET /v1/update/package` serves), null when the install has none.
 */
export const updateStatusSchema = z.object({
  state: updateStateSchema,
  message: z.string().nullable(),
  version: z.string().nullable(),
  packageSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  at: isoTimestamp.nullable(),
});

export const machineSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  name: z.string().min(1),
  hostname: z.string().min(1),
  os: machineOsSchema,
  version: z.string().min(1),
  claudeVersion: z.string().nullable(),
  sessionsCount: z.number().int().nonnegative(),
  models: z.array(z.string().min(1)),
  ghosttyAutomation: ghosttyAutomationSchema,
  /** False when `owned.allowBypass` is off: sessions started here cannot run in bypassPermissions. */
  allowBypass: z.boolean(),
  /** False when `coordinator.enabled` is off: `POST /v1/coordinator` answers `unsupported`. */
  coordinatorEnabled: z.boolean(),
  /** The names of this machine's Claude homes (accounts), in config order; the first is the default home of new sessions. */
  homes: z.array(z.string().min(1)),
  tailscale: z.object({ state: tailscaleStateSchema }),
  /** What this daemon can do (src/contract/features.ts). An app decides by these names, never by version numbers. */
  features: z.array(z.string().min(1)),
  update: updateStatusSchema,
});

export const sessionSummarySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  status: sessionStatusSchema,
  waitingFor: waitingReasonSchema.nullable(),
  owned: z.boolean(),
  agent: agentSchema,
  replyMode: replyModeSchema,
  canStop: z.boolean(),
  /** Background tasks (run_in_background commands, background agents, monitors) the session started and that have not finished; 0 for a stopped session. Status stays "idle": the app says "Working in the background" when idle and this is above 0. */
  background: z.number().int().nonnegative(),
  summary: z.string(),
  model: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  /** The name of the Claude home (account) the session lives in, never its path. */
  home: z.string().min(1).nullable(),
  muted: z.boolean(),
  label: sessionLabelSchema,
  /** The automatic colour of the session, one of the presets, chosen by the daemon so every device shows the same; the user's `label.color` wins. */
  autoColor: labelColorSchema.nullable(),
  /** The mode of the session's last turn (from the transcript); null when the transcript has none. */
  permissionMode: permissionModeSchema.nullable(),
  /** Context size of the last turn: input + cache read + cache creation tokens of the last main assistant message. */
  contextTokens: z.number().int().nonnegative().nullable(),
  /** When the prompt cache of the last turn goes cold (its timestamp + 5 min or 1 h, by the cache bucket it used). */
  cacheExpiresAt: isoTimestamp.nullable(),
  /** When the last turn ended (its last main assistant message); null right after a compaction. Claude Code shows its
   *  "new task? /clear to save N tokens" hint from this: 75 min idle and 100k tokens or more. */
  lastTurnAt: isoTimestamp.nullable(),
  startedAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

const activityBase = { id: z.string().min(1), ts: isoTimestamp };

export const userActivitySchema = z.object({ ...activityBase, kind: z.literal("user"), text: z.string() });
export const assistantActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("assistant"),
  text: z.string(),
});
export const toolActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("tool"),
  tool: z.string().min(1),
  title: z.string().min(1),
  status: toolStatusSchema,
  hasDetail: z.boolean(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export const filesActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("files"),
  title: z.string().min(1),
  changed: z.array(z.string().min(1)).min(1),
});
export const questionActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("question"),
  requestId: z.string().min(1),
  text: z.string().min(1),
  options: z.array(z.string().min(1)),
  state: questionStateSchema,
  /** Only with state "terminal": answering an option from the phone types the matching keys into the terminal dialog. */
  typable: z.boolean().optional(),
});
/**
 * A blocking dialog of Claude Code, passed through as it sent it (`dialogKind`, opaque `payload`). The daemon computes
 * nothing from it: Claude Code decides when a dialog shows. `choices` are the answers valid for this dialog.
 * The state is "pending" until answered ("answered") or withdrawn ("expired").
 */
export const dialogActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("dialog"),
  requestId: z.string().min(1),
  dialogKind: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  choices: z.array(z.string().min(1)),
  state: dialogStateSchema,
});
export const permissionActivitySchema = z.object({
  ...activityBase,
  kind: z.literal("permission"),
  requestId: z.string().min(1),
  tool: z.string().min(1),
  title: z.string().min(1),
  summary: z.string(),
  cwd: z.string().min(1),
  destructive: z.boolean(),
  state: permissionStateSchema,
  /** Only with state "terminal": Allow or Deny from the phone types the matching key into the terminal dialog. */
  typable: z.boolean().optional(),
  /** Only for a plan request (tool ExitPlanMode): the whole plan as Markdown, never cut. `title` is "Ready to code?", `summary` its first line. */
  plan: z.string().optional(),
  /** Only with `plan`: the decisions this plan request takes, in display order. Older apps ignore it and show Allow and Deny. */
  planChoices: z.array(planChoiceSchema).optional(),
});
export const systemActivitySchema = z.object({ ...activityBase, kind: z.literal("system"), text: z.string() });

export const activitySchema = z.discriminatedUnion("kind", [
  userActivitySchema,
  assistantActivitySchema,
  toolActivitySchema,
  filesActivitySchema,
  questionActivitySchema,
  dialogActivitySchema,
  permissionActivitySchema,
  systemActivitySchema,
]);

export const activityPageSchema = z.object({
  items: z.array(activitySchema),
  nextBefore: z.string().min(1).nullable(),
});

export const detailLineSchema = z.object({
  number: z.number().int().positive().nullable(),
  sign: z.enum([" ", "+", "-"]),
  text: z.string(),
});

export const detailSectionSchema = z.object({
  title: z.string().min(1),
  subtitle: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  lines: z.array(detailLineSchema),
});

export const activityDetailSchema = z.object({
  activityId: z.string().min(1),
  kind: z.enum(["diff", "output"]),
  truncated: z.boolean(),
  sections: z.array(detailSectionSchema),
});

export const recentFolderSchema = z.object({ path: z.string().min(1), lastUsedAt: isoTimestamp });
export const recentFoldersSchema = z.object({ folders: z.array(recentFolderSchema) });

/** Folders matching a name query: recently used ones first, then git repos found under the dev folder. */
export const folderSearchSchema = z.object({
  folders: z.array(z.object({ path: z.string().min(1), recent: z.boolean() })),
});
/** The running coordinator session, or null when none has been started since the daemon started. */
export const coordinatorStateSchema = z.object({ sessionId: z.string().min(1).nullable() });

/** `attachments`: ids from `POST /v1/sessions/:id/attachments` on that same session; their paths are appended to the text. */
export const messageRequestSchema = z.object({ text: z.string().min(1), attachments: z.array(z.string().min(1)).optional() });
/** `closeTab: true` also closes the terminal pane or tab the session runs in. The whole body may be left out (= false). */
export const ghosttyProbeResultSchema = z.object({ ghosttyAutomation: ghosttyAutomationSchema });
export const killRequestSchema = z.object({ closeTab: z.boolean() });
export const closedTargetSchema = z.enum(["pane", "tab", "none"]);
export const killResultSchema = z.object({ ok: z.literal(true), closed: closedTargetSchema });
export const attachmentResultSchema = z.object({
  attachmentId: z.string().min(1),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export const telemetryReportSchema = z.object({
  id: z.uuid(),
  at: isoTimestamp,
  message: z.string().min(1),
  /** Absent = "error" (older apps). "event" = something that happened (screen opened, action done, push received), with timing. */
  kind: z.enum(["error", "event"]).optional(),
  /** How long the action took, for events like "open session" or "send message". */
  durationMs: z.number().int().nonnegative().optional(),
  code: z.string().min(1).optional(),
  area: z.string().min(1),
  machine: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  appVersion: z.string().min(1),
  build: z.string().min(1),
  platform: z.string().min(1),
});
export const telemetryBatchSchema = z.object({ reports: z.array(telemetryReportSchema).min(1).max(200) });
/** `accepted` = newly stored, `duplicates` = ids the daemon already had. */
export const telemetryResultSchema = z.object({ accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative() });
/** Pause every push of this machine until a time. `minutes: 0` resumes at once. */
export const notificationPauseRequestSchema = z.object({ minutes: z.number().int().min(0).max(10_080) });
export const notificationStateSchema = z.object({ pausedUntil: isoTimestamp.nullable() });
/** A session the user removed from the list (stopped sessions only); it comes back by itself when it runs again. */
export const hiddenSessionSchema = z.object({ id: z.string().min(1), title: z.string().min(1), cwd: z.string().min(1), updatedAt: isoTimestamp });
export const hiddenSessionListSchema = z.object({ sessions: z.array(hiddenSessionSchema) });
export const telemetryListSchema =z.object({ reports: z.array(telemetryReportSchema) });
export const permissionRequestSchema = z.object({
  decision: permissionDecisionSchema,
  /** What Claude should change in the plan: required for `revise`, ignored by every other decision. */
  message: z.string().min(1).optional(),
});
export const answerRequestSchema = z.object({ option: z.string().min(1) });
/** The answer to a Claude Code dialog: one of the dialog activity's `choices`. */
export const dialogAnswerRequestSchema = z.object({ answer: z.string().min(1) });
export const muteRequestSchema = z.object({ muted: z.boolean() });
/** A patch: only the keys present change. An empty name (after trim) clears the custom name. */
export const labelRequestSchema = z.object({
  name: z.string().trim().max(80).nullable().optional(),
  color: labelColorSchema.nullable().optional(),
  pinned: z.boolean().optional(),
});
export const newSessionRequestSchema = z.object({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  worktree: z.boolean(),
  model: z.string().min(1).nullable(),
  /** Omitted = the daemon's `owned.permissionMode` (default `default`); `bypassPermissions` needs `owned.allowBypass`. */
  permissionMode: permissionModeSchema.optional(),
  /** The name of one of `machine.homes`; an unknown name is refused. Omitted = the machine's first home. */
  home: z.string().min(1).optional(),
});
/** Hub view of one machine, as the hub last saw it. The hub itself is always first. */
export const hubMachineSchema = z.object({
  name: z.string().min(1),
  online: z.boolean(),
  /** The hub's own entry is always online with `hub: true`. */
  hub: z.boolean(),
  lastSeen: isoTimestamp.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  /** Why the machine is offline, in a sentence a non-specialist understands (null when online). */
  problem: z.string().nullable(),
  /** The technical cause behind `problem` (error code, HTTP status), for support; null when online. */
  detail: z.string().nullable(),
  sessions: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  /** The machine's operating system; omitted while the hub has not heard from the peer yet. */
  os: machineOsSchema.optional(),
});
export const hubStateSchema = z.object({ hub: z.string().min(1), checkedAt: isoTimestamp, machines: z.array(hubMachineSchema) });
/** `POST /v1/machine/update` answers at once; the install runs in the background and `machine.update` tells the rest. */
export const machineUpdateResultSchema = z.object({ ok: z.literal(true), state: z.literal("running") });
/** "started": the package was handed over and installs now; "current": already on the newest version; "failed": see `message`. */
export const updateAllMachineSchema = z.object({
  name: z.string().min(1),
  from: z.string().nullable(),
  result: z.enum(["started", "current", "failed"]),
  message: z.string().min(1),
});
/** `POST /v1/hub/update-all`: `source` = the machine whose package was used, `version` = the newest version in the fleet. */
export const updateAllResultSchema = z.object({ source: z.string().min(1), version: z.string().min(1), machines: z.array(updateAllMachineSchema) });
export const coordinatorRequestSchema =z.object({ prompt: z.string().min(1) });
export const deviceRequestSchema = z.object({
  apnsToken: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: apnsEnvironmentSchema,
  name: z.string().min(1),
  notifications: z.array(notificationTypeSchema),
});

export const actionResultSchema = z.object({ sessionId: z.string().min(1) });
export const okResultSchema = z.object({ ok: z.literal(true) });
export const imageResultSchema = z.object({ ok: z.literal(true), image: z.string().regex(IMAGE_HASH_PATTERN) });
/** `queued: true` = the session was busy and will read the message after its current turn. */
export const messageResultSchema = z.object({ ok: z.literal(true), queued: z.boolean().optional() });

export const errorCodeSchema = z.enum([
  "unauthorized",
  "not_found",
  "invalid_request",
  "conflict",
  "unsupported",
  "internal",
  "token_revoked",
  "rate_limited",
  /** The caller is known but not allowed here: a device of another tailnet user tried to pair (HTTP 403). */
  "forbidden",
  /** The hub knows the target machine is not reachable right now (HTTP 503). */
  "machine_offline",
  /** Tailscale on this computer does not answer, so nobody can be identified (HTTP 503). */
  "tailscale_unavailable",
  /** A device token came from another Tailscale node than the one it was paired from: pair again (HTTP 401). */
  "device_moved",
  /** The master token came from a node that is neither this computer nor its hub (HTTP 401). */
  "master_token_wrong_node",
]);
export const errorResponseSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string().min(1) }),
});

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), machine: machineSchema, sessions: z.array(sessionSummarySchema) }),
  z.object({ type: z.literal("session"), session: sessionSummarySchema }),
  z.object({ type: z.literal("activity"), sessionId: z.string().min(1), activity: activitySchema }),
  z.object({ type: z.literal("ping"), ts: isoTimestamp }),
]);

/** What the QR code and the fardesk://pair link carry: a one-time code (valid 2 minutes), never the master token. */
export const pairingPayloadSchema = z.object({
  v: z.literal(CONTRACT_VERSION),
  name: z.string().min(1),
  url: z.url({ protocol: /^http$/ }),
  code: z.string().min(32),
  /** True when this machine is a hub: the app then shows every machine the hub knows. */
  hub: z.boolean(),
});

/** `POST /v1/auth/pair` (no bearer): the code from the pairing link in exchange for a device token. */
export const pairRequestSchema = z.object({ code: z.string().min(32), deviceName: z.string().min(1) });
/** `POST /v1/auth/pair-code` (bearer): opens the pairing window: a fresh single-use code for a pairing link. */
export const pairCodeResultSchema = z.object({ code: z.string().min(32), expiresAt: isoTimestamp });
export const peerSchema = z.object({ name: z.string().min(1), url: z.url({ protocol: /^http$/ }) });
export const loginResultSchema = z.object({
  token: z.string().min(32),
  deviceId: z.string().min(1),
  machine: machineSchema,
  peers: z.array(peerSchema),
});
export const logoutRequestSchema = z.object({ apnsToken: z.string().min(1).nullable() });
export const authDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoTimestamp,
  lastSeenAt: isoTimestamp.nullable(),
  lastIp: z.string().min(1).nullable(),
  revoked: z.boolean(),
  current: z.boolean(),
});
export const authDeviceListSchema = z.object({ devices: z.array(authDeviceSchema) });
// device: an id or a device name; null revokes every device.
export const revokeRequestSchema = z.object({ device: z.string().min(1).nullable() });
export const revokeResultSchema = z.object({ revoked: z.number().int().nonnegative() });
export const WIPE_COMMAND = "wipe";

export const contractSchemas = {
  Machine: machineSchema,
  SessionSummary: sessionSummarySchema,
  Activity: activitySchema,
  ActivityPage: activityPageSchema,
  ActivityDetail: activityDetailSchema,
  RecentFolders: recentFoldersSchema,
  FolderSearch: folderSearchSchema,
  CoordinatorState: coordinatorStateSchema,
  MessageRequest: messageRequestSchema,
  KillRequest: killRequestSchema,
  GhosttyProbeResult: ghosttyProbeResultSchema,
  KillResult: killResultSchema,
  AttachmentResult: attachmentResultSchema,
  TelemetryReport: telemetryReportSchema,
  TelemetryBatch: telemetryBatchSchema,
  TelemetryResult: telemetryResultSchema,
  TelemetryList: telemetryListSchema,
  PermissionRequest: permissionRequestSchema,
  AnswerRequest: answerRequestSchema,
  DialogAnswerRequest: dialogAnswerRequestSchema,
  MuteRequest: muteRequestSchema,
  LabelRequest: labelRequestSchema,
  LabelPalette: labelPaletteSchema,
  NewSessionRequest: newSessionRequestSchema,
  CoordinatorRequest: coordinatorRequestSchema,
  DeviceRequest: deviceRequestSchema,
  ActionResult: actionResultSchema,
  NotificationPauseRequest: notificationPauseRequestSchema,
  NotificationState: notificationStateSchema,
  HiddenSessionList: hiddenSessionListSchema,
  HubMachine: hubMachineSchema,
  HubState: hubStateSchema,
  MachineUpdateResult: machineUpdateResultSchema,
  UpdateAllResult: updateAllResultSchema,
  OkResult: okResultSchema,
  ImageResult: imageResultSchema,
  MessageResult: messageResultSchema,
  ErrorResponse: errorResponseSchema,
  StreamEvent: streamEventSchema,
  PairingPayload: pairingPayloadSchema,
  PairRequest: pairRequestSchema,
  PairCodeResult: pairCodeResultSchema,
  LoginResult: loginResultSchema,
  LogoutRequest: logoutRequestSchema,
  AuthDeviceList: authDeviceListSchema,
  RevokeRequest: revokeRequestSchema,
  RevokeResult: revokeResultSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type WaitingReason = z.infer<typeof waitingReasonSchema>;
export type Agent = z.infer<typeof agentSchema>;
export type ReplyMode = z.infer<typeof replyModeSchema>;
export type PermissionState = z.infer<typeof permissionStateSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type PlanChoice = z.infer<typeof planChoiceSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type SessionLabel = z.infer<typeof sessionLabelSchema>;
export type ImageResult = z.infer<typeof imageResultSchema>;
export type LabelRequest = z.infer<typeof labelRequestSchema>;
export type Machine =z.infer<typeof machineSchema>;
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export type Activity = z.infer<typeof activitySchema>;
export type ToolActivity = z.infer<typeof toolActivitySchema>;
export type ActivityPage = z.infer<typeof activityPageSchema>;
export type ActivityDetail = z.infer<typeof activityDetailSchema>;
export type DetailSection = z.infer<typeof detailSectionSchema>;
export type DetailLine = z.infer<typeof detailLineSchema>;
export type RecentFolders = z.infer<typeof recentFoldersSchema>;
export type FolderSearch = z.infer<typeof folderSearchSchema>;
export type CoordinatorState = z.infer<typeof coordinatorStateSchema>;
export type NewSessionRequest = z.infer<typeof newSessionRequestSchema>;
export type PermissionMode = z.infer<typeof permissionModeSchema>;
export type HubMachine = z.infer<typeof hubMachineSchema>;
export type HubState = z.infer<typeof hubStateSchema>;
export type UpdateStatus = z.infer<typeof updateStatusSchema>;
export type UpdateAllResult = z.infer<typeof updateAllResultSchema>;
export type UpdateAllMachine = z.infer<typeof updateAllMachineSchema>;
export type MachineUpdateResult = z.infer<typeof machineUpdateResultSchema>;
export type CoordinatorRequest = z.infer<typeof coordinatorRequestSchema>;
export type DeviceRequest = z.infer<typeof deviceRequestSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type PairingPayload = z.infer<typeof pairingPayloadSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PairCodeResult = z.infer<typeof pairCodeResultSchema>;
export type Peer = z.infer<typeof peerSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type AuthDevice = z.infer<typeof authDeviceSchema>;
export type AuthDeviceList = z.infer<typeof authDeviceListSchema>;
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;
export type ClosedTarget = z.infer<typeof closedTargetSchema>;
export type GhosttyAutomation = z.infer<typeof ghosttyAutomationSchema>;
export type KillRequest = z.infer<typeof killRequestSchema>;
export type AttachmentResult = z.infer<typeof attachmentResultSchema>;
export type TelemetryReport = z.infer<typeof telemetryReportSchema>;
export type NotificationState = z.infer<typeof notificationStateSchema>;
export type HiddenSession = z.infer<typeof hiddenSessionSchema>;
