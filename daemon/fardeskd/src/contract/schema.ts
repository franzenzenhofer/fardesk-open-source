// Single source of truth for everything that crosses the wire between fardeskd and its clients.
// JSON Schema files in schema/ and the golden fixtures in schema/fixtures/ are generated from here.
import { z } from "zod";

export const CONTRACT_VERSION = 1;

export const sessionStatusSchema = z.enum(["working", "waiting", "idle", "ended"]);
/**
 * What a waiting session needs. "permission" and "question": the daemon holds a request the phone can answer.
 * "terminal": a dialog is open at the computer and the daemon holds no request for it, so only the terminal can answer.
 */
export const waitingReasonSchema = z.enum(["permission", "question", "terminal"]);
export const replyModeSchema = z.enum(["composer", "takeover", "resume"]);
export const toolStatusSchema = z.enum(["running", "ok", "error"]);
/** "terminal": the phone was not asked in time and the dialog now waits at the computer (see `typable`). */
export const permissionStateSchema = z.enum(["pending", "allowed", "denied", "expired", "terminal"]);
export const questionStateSchema = z.enum(["pending", "answered", "expired", "terminal"]);
export const permissionDecisionSchema = z.enum(["allow", "deny", "allow_always"]);
export const machineOsSchema = z.enum(["macos", "linux"]);
/** Whether the daemon may drive Ghostty through AppleScript (macOS Automation consent): "unknown" until it tried. */
export const ghosttyAutomationSchema = z.enum(["ok", "denied", "unknown"]);
export const apnsEnvironmentSchema = z.enum(["sandbox", "production"]);
export const notificationTypeSchema = z.enum(["done", "permission", "question", "ended"]);
/** Claude Code permission modes (Agent SDK `PermissionMode`). Fardesk starts sessions in `bypassPermissions` unless told otherwise. */
export const permissionModeSchema = z.enum(["default", "acceptEdits", "plan", "bypassPermissions", "dontAsk", "auto"]);

const isoTimestamp = z.iso.datetime();

export const labelColorSchema = z.enum(["blue", "teal", "purple", "pink"]);
/** The user's own name, colour and pin for a session; `name: null` means the app shows `title`. */
export const sessionLabelSchema = z.strictObject({ name: z.string().min(1).max(80).nullable(), color: labelColorSchema.nullable(), pinned: z.boolean() });

export const machineSchema = z.strictObject({
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
});

export const sessionSummarySchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1),
  cwd: z.string().min(1),
  status: sessionStatusSchema,
  waitingFor: waitingReasonSchema.nullable(),
  owned: z.boolean(),
  replyMode: replyModeSchema,
  canStop: z.boolean(),
  summary: z.string(),
  model: z.string().nullable(),
  pid: z.number().int().positive().nullable(),
  muted: z.boolean(),
  label: sessionLabelSchema,
  /** The mode of the session's last turn (from the transcript); null when the transcript has none. */
  permissionMode: permissionModeSchema.nullable(),
  /** Context size of the last turn: input + cache read + cache creation tokens of the last main assistant message. */
  contextTokens: z.number().int().nonnegative().nullable(),
  /** When the prompt cache of the last turn goes cold (its timestamp + 5 min or 1 h, by the cache bucket it used). */
  cacheExpiresAt: isoTimestamp.nullable(),
  startedAt: isoTimestamp,
  updatedAt: isoTimestamp,
});

const activityBase = { id: z.string().min(1), ts: isoTimestamp };

export const userActivitySchema = z.strictObject({ ...activityBase, kind: z.literal("user"), text: z.string() });
export const assistantActivitySchema = z.strictObject({
  ...activityBase,
  kind: z.literal("assistant"),
  text: z.string(),
});
export const toolActivitySchema = z.strictObject({
  ...activityBase,
  kind: z.literal("tool"),
  tool: z.string().min(1),
  title: z.string().min(1),
  status: toolStatusSchema,
  hasDetail: z.boolean(),
  durationMs: z.number().int().nonnegative().nullable(),
});
export const filesActivitySchema = z.strictObject({
  ...activityBase,
  kind: z.literal("files"),
  title: z.string().min(1),
  changed: z.array(z.string().min(1)).min(1),
});
export const questionActivitySchema = z.strictObject({
  ...activityBase,
  kind: z.literal("question"),
  requestId: z.string().min(1),
  text: z.string().min(1),
  options: z.array(z.string().min(1)),
  state: questionStateSchema,
  /** Only with state "terminal": answering an option from the phone types the matching keys into the terminal dialog. */
  typable: z.boolean().optional(),
});
export const permissionActivitySchema = z.strictObject({
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
});
export const systemActivitySchema = z.strictObject({ ...activityBase, kind: z.literal("system"), text: z.string() });

export const activitySchema = z.discriminatedUnion("kind", [
  userActivitySchema,
  assistantActivitySchema,
  toolActivitySchema,
  filesActivitySchema,
  questionActivitySchema,
  permissionActivitySchema,
  systemActivitySchema,
]);

export const activityPageSchema = z.strictObject({
  items: z.array(activitySchema),
  nextBefore: z.string().min(1).nullable(),
});

export const detailLineSchema = z.strictObject({
  number: z.number().int().positive().nullable(),
  sign: z.enum([" ", "+", "-"]),
  text: z.string(),
});

export const detailSectionSchema = z.strictObject({
  title: z.string().min(1),
  subtitle: z.string(),
  added: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  lines: z.array(detailLineSchema),
});

export const activityDetailSchema = z.strictObject({
  activityId: z.string().min(1),
  kind: z.enum(["diff", "output"]),
  truncated: z.boolean(),
  sections: z.array(detailSectionSchema),
});

export const recentFolderSchema = z.strictObject({ path: z.string().min(1), lastUsedAt: isoTimestamp });
export const recentFoldersSchema = z.strictObject({ folders: z.array(recentFolderSchema) });

/** Folders matching a name query: recently used ones first, then git repos found under the dev folder. */
export const folderSearchSchema = z.strictObject({
  folders: z.array(z.strictObject({ path: z.string().min(1), recent: z.boolean() })),
});
/** The running coordinator session, or null when none has been started since the daemon started. */
export const coordinatorStateSchema = z.strictObject({ sessionId: z.string().min(1).nullable() });

/** `attachments`: ids from `POST /v1/sessions/:id/attachments` on that same session; their paths are appended to the text. */
export const messageRequestSchema = z.strictObject({ text: z.string().min(1), attachments: z.array(z.string().min(1)).optional() });
/** `closeTab: true` also closes the terminal pane or tab the session runs in. The whole body may be left out (= false). */
export const ghosttyProbeResultSchema = z.strictObject({ ghosttyAutomation: ghosttyAutomationSchema });
export const killRequestSchema = z.strictObject({ closeTab: z.boolean() });
export const closedTargetSchema = z.enum(["pane", "tab", "none"]);
export const killResultSchema = z.strictObject({ ok: z.literal(true), closed: closedTargetSchema });
export const attachmentResultSchema = z.strictObject({
  attachmentId: z.string().min(1),
  path: z.string().min(1),
  mediaType: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export const telemetryReportSchema = z.strictObject({
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
export const telemetryBatchSchema = z.strictObject({ reports: z.array(telemetryReportSchema).min(1).max(200) });
/** `accepted` = newly stored, `duplicates` = ids the daemon already had. */
export const telemetryResultSchema = z.strictObject({ accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative() });
/** Pause every push of this machine until a time. `minutes: 0` resumes at once. */
export const notificationPauseRequestSchema = z.strictObject({ minutes: z.number().int().min(0).max(10_080) });
export const notificationStateSchema = z.strictObject({ pausedUntil: isoTimestamp.nullable() });
export const telemetryListSchema =z.strictObject({ reports: z.array(telemetryReportSchema) });
export const permissionRequestSchema = z.strictObject({ decision: permissionDecisionSchema });
export const answerRequestSchema = z.strictObject({ option: z.string().min(1) });
export const muteRequestSchema = z.strictObject({ muted: z.boolean() });
/** A patch: only the keys present change. An empty name (after trim) clears the custom name. */
export const labelRequestSchema = z.strictObject({
  name: z.string().trim().max(80).nullable().optional(),
  color: labelColorSchema.nullable().optional(),
  pinned: z.boolean().optional(),
});
export const newSessionRequestSchema = z.strictObject({
  cwd: z.string().min(1),
  prompt: z.string().min(1),
  worktree: z.boolean(),
  model: z.string().min(1).nullable(),
  /** Omitted = the daemon's `owned.permissionMode` (default `default`); `bypassPermissions` needs `owned.allowBypass`. */
  permissionMode: permissionModeSchema.optional(),
});
/** Hub view of one machine, as the hub last saw it. The hub itself is always first. */
export const hubMachineSchema = z.strictObject({
  name: z.string().min(1),
  online: z.boolean(),
  /** The hub's own entry is always online with `hub: true`. */
  hub: z.boolean(),
  lastSeen: isoTimestamp.nullable(),
  latencyMs: z.number().int().nonnegative().nullable(),
  /** Why the machine is offline, in plain words (null when online). */
  problem: z.string().nullable(),
  sessions: z.number().int().nonnegative(),
  waiting: z.number().int().nonnegative(),
  working: z.number().int().nonnegative(),
  /** The machine's operating system; omitted while the hub has not heard from the peer yet. */
  os: machineOsSchema.optional(),
});
export const hubStateSchema = z.strictObject({ hub: z.string().min(1), checkedAt: isoTimestamp, machines: z.array(hubMachineSchema) });
export const coordinatorRequestSchema = z.strictObject({ prompt: z.string().min(1) });
export const deviceRequestSchema = z.strictObject({
  apnsToken: z.string().regex(/^[0-9a-f]{64,200}$/),
  environment: apnsEnvironmentSchema,
  name: z.string().min(1),
  notifications: z.array(notificationTypeSchema),
});

export const actionResultSchema = z.strictObject({ sessionId: z.string().min(1) });
export const okResultSchema = z.strictObject({ ok: z.literal(true) });
/** `queued: true` = the session was busy and will read the message after its current turn. */
export const messageResultSchema = z.strictObject({ ok: z.literal(true), queued: z.boolean().optional() });

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
]);
export const errorResponseSchema = z.strictObject({
  error: z.strictObject({ code: errorCodeSchema, message: z.string().min(1) }),
});

export const streamEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("hello"), machine: machineSchema, sessions: z.array(sessionSummarySchema) }),
  z.strictObject({ type: z.literal("session"), session: sessionSummarySchema }),
  z.strictObject({ type: z.literal("activity"), sessionId: z.string().min(1), activity: activitySchema }),
  z.strictObject({ type: z.literal("ping"), ts: isoTimestamp }),
]);

/** What the QR code and the fardesk://pair link carry: a one-time code (valid 2 minutes), never the master token. */
export const pairingPayloadSchema = z.strictObject({
  v: z.literal(CONTRACT_VERSION),
  name: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  code: z.string().min(32),
  /** True when this machine is a hub: the app then shows every machine the hub knows. */
  hub: z.boolean(),
});

export const MIN_PASSWORD_LENGTH = 12;
/** `POST /v1/auth/pair` (no bearer): the code from the pairing link in exchange for a device token. */
export const pairRequestSchema = z.strictObject({ code: z.string().min(32), deviceName: z.string().min(1) });
/** `POST /v1/auth/pair-code` (bearer): opens the pairing window: a fresh single-use code for a pairing link. */
export const pairCodeResultSchema = z.strictObject({ code: z.string().min(32), expiresAt: isoTimestamp });
export const peerSchema = z.strictObject({ name: z.string().min(1), url: z.url({ protocol: /^https?$/ }) });
export const loginRequestSchema = z.strictObject({ password: z.string().min(1), deviceName: z.string().min(1) });
export const loginResultSchema = z.strictObject({
  token: z.string().min(32),
  deviceId: z.string().min(1),
  machine: machineSchema,
  peers: z.array(peerSchema),
});
export const logoutRequestSchema = z.strictObject({ apnsToken: z.string().min(1).nullable() });
export const authDeviceSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoTimestamp,
  lastSeenAt: isoTimestamp.nullable(),
  lastIp: z.string().min(1).nullable(),
  revoked: z.boolean(),
  current: z.boolean(),
});
export const authDeviceListSchema = z.strictObject({ devices: z.array(authDeviceSchema) });
// device: an id or a device name; null revokes every device.
export const revokeRequestSchema = z.strictObject({ device: z.string().min(1).nullable() });
export const revokeResultSchema = z.strictObject({ revoked: z.number().int().nonnegative() });
export const passwordChangeRequestSchema = z.strictObject({
  current: z.string().min(1),
  next: z.string().min(MIN_PASSWORD_LENGTH),
});
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
  MuteRequest: muteRequestSchema,
  LabelRequest: labelRequestSchema,
  NewSessionRequest: newSessionRequestSchema,
  CoordinatorRequest: coordinatorRequestSchema,
  DeviceRequest: deviceRequestSchema,
  ActionResult: actionResultSchema,
  NotificationPauseRequest: notificationPauseRequestSchema,
  NotificationState: notificationStateSchema,
  HubMachine: hubMachineSchema,
  HubState: hubStateSchema,
  OkResult: okResultSchema,
  MessageResult: messageResultSchema,
  ErrorResponse: errorResponseSchema,
  StreamEvent: streamEventSchema,
  PairingPayload: pairingPayloadSchema,
  PairRequest: pairRequestSchema,
  PairCodeResult: pairCodeResultSchema,
  LoginRequest: loginRequestSchema,
  LoginResult: loginResultSchema,
  LogoutRequest: logoutRequestSchema,
  AuthDeviceList: authDeviceListSchema,
  RevokeRequest: revokeRequestSchema,
  RevokeResult: revokeResultSchema,
  PasswordChangeRequest: passwordChangeRequestSchema,
} as const;

export type ContractName = keyof typeof contractSchemas;
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type WaitingReason = z.infer<typeof waitingReasonSchema>;
export type ReplyMode = z.infer<typeof replyModeSchema>;
export type PermissionState = z.infer<typeof permissionStateSchema>;
export type PermissionDecision = z.infer<typeof permissionDecisionSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type SessionLabel = z.infer<typeof sessionLabelSchema>;
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
export type CoordinatorRequest = z.infer<typeof coordinatorRequestSchema>;
export type DeviceRequest = z.infer<typeof deviceRequestSchema>;
export type StreamEvent = z.infer<typeof streamEventSchema>;
export type PairingPayload = z.infer<typeof pairingPayloadSchema>;
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export type PairRequest = z.infer<typeof pairRequestSchema>;
export type PairCodeResult = z.infer<typeof pairCodeResultSchema>;
export type Peer = z.infer<typeof peerSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResult = z.infer<typeof loginResultSchema>;
export type AuthDevice = z.infer<typeof authDeviceSchema>;
export type AuthDeviceList = z.infer<typeof authDeviceListSchema>;
export type RevokeRequest = z.infer<typeof revokeRequestSchema>;
export type PasswordChangeRequest = z.infer<typeof passwordChangeRequestSchema>;
export type ClosedTarget = z.infer<typeof closedTargetSchema>;
export type GhosttyAutomation = z.infer<typeof ghosttyAutomationSchema>;
export type KillRequest = z.infer<typeof killRequestSchema>;
export type AttachmentResult = z.infer<typeof attachmentResultSchema>;
export type TelemetryReport = z.infer<typeof telemetryReportSchema>;
export type NotificationState = z.infer<typeof notificationStateSchema>;
