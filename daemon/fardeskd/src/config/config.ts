import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { notificationTypeSchema, peerSchema, permissionModeSchema, type NotificationType, type PermissionMode, type Peer } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { writeJsonState } from "../core/jsonState.js";
import { DEFAULT_SCAN_ROOTS, scanRootSchema } from "../folders/search.js";

export { resolveBindAddress, runCommand, type RunCommand } from "./bind.js";

const MIN_TOKEN_LENGTH = 32;
const TOKEN_BYTES = 32;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const HOME_PREFIX = "~";
const CONFIG_ENV_VAR = "FARDESK_CONFIG";
const DEFAULT_CONFIG_RELATIVE = ".config/fardesk/config.json";

export const CONFIG_DEFAULTS = {
  bind: { address: "tailscale", port: 4780, allowNonTailnet: false },
  tls: null,
  claudeHomes: ["~/.claude"],
  claudeBinary: "claude",
  stateDir: "~/.local/state/fardesk",
  models: ["default", "fable", "opus", "sonnet", "haiku"],
  intervals: { registryPollMs: 1000, transcriptPollMs: 500, pingMs: 20000, typablePollMs: 5000 },
  permissionTimeoutSeconds: 900,
  activityPageLimit: { default: 50, max: 200 },
  detail: { maxOutputLines: 40, maxDiffLines: 400 },
  owned: { permissionMode: "default" as PermissionMode, allowBypass: false, interruptTimeoutMs: 5000 },
  delivery: { timeoutMs: 8000, pollMs: 200 },
  kill: { timeoutMs: 5000, pollMs: 100 },
  summaryMaxChars: 80,
  notifications: ["done", "permission", "question", "ended"] as NotificationType[],
  apns: null,
  tmuxBinary: "tmux",
  osascriptBinary: "osascript",
  auth: { passwordHash: null, maxFailures: 5, windowSeconds: 300 },
  pairing: { allowedUsers: [] as string[], allowedTags: [] as string[] },
  peers: [] as Peer[],
  sessions: { maxEnded: 200, maxFolders: 20, readsPerPoll: 20, tidyList: true, listEnded: 10, listEndedWithinDays: 24 },
  coordinator: {
    enabled: false,
    permissionMode: "default" as PermissionMode,
    fullTools: false,
    mayApprove: false,
    peerTokens: {} as Record<string, string>,
    model: null as string | null,
  },
  push: { content: "generic" as PushContent },
  hub: { enabled: false, probeMs: 5000 },
  folders: { scanRoots: DEFAULT_SCAN_ROOTS },
};

export const pushContentSchema = z.enum(["generic", "full"]);
export type PushContent = z.infer<typeof pushContentSchema>;

const authSchema = z.strictObject({
  passwordHash: z.string().min(1).nullable().default(CONFIG_DEFAULTS.auth.passwordHash),
  maxFailures: z.number().int().positive().default(CONFIG_DEFAULTS.auth.maxFailures),
  windowSeconds: z.number().int().positive().default(CONFIG_DEFAULTS.auth.windowSeconds),
});

const sessionsSchema = z.strictObject({
  maxEnded: z.number().int().positive().default(CONFIG_DEFAULTS.sessions.maxEnded),
  maxFolders: z.number().int().positive().default(CONFIG_DEFAULTS.sessions.maxFolders),
  readsPerPoll: z.number().int().positive().default(CONFIG_DEFAULTS.sessions.readsPerPoll),
  /**
   * Clients get live sessions plus the newest `listEnded` ended ones of the last `listEndedWithinDays` days, without
   * test temp folders, deleted folders and old coordinator sessions (sessions/visible.ts). Test daemons turn it off.
   */
  tidyList: z.boolean().default(CONFIG_DEFAULTS.sessions.tidyList),
  listEnded: z.number().int().positive().default(CONFIG_DEFAULTS.sessions.listEnded),
  listEndedWithinDays: z.number().int().positive().default(CONFIG_DEFAULTS.sessions.listEndedWithinDays),
});

/**
 * enabled: the Coordinator route answers `unsupported` while false. permissionMode: "bypassPermissions" also needs
 * `owned.allowBypass`. fullTools: Bash, Edit, Write, WebFetch and the other built-in tools (else only Read and Grep plus
 * the fardesk tools). mayApprove: `answer_request` may allow permission requests of other sessions.
 */
const coordinatorSchema = z.strictObject({
  enabled: z.boolean().default(CONFIG_DEFAULTS.coordinator.enabled),
  permissionMode: permissionModeSchema.default(CONFIG_DEFAULTS.coordinator.permissionMode),
  fullTools: z.boolean().default(CONFIG_DEFAULTS.coordinator.fullTools),
  mayApprove: z.boolean().default(CONFIG_DEFAULTS.coordinator.mayApprove),
  peerTokens: z.record(z.string().min(1), z.string().min(1)).default(CONFIG_DEFAULTS.coordinator.peerTokens),
  model: z.string().min(1).nullable().default(CONFIG_DEFAULTS.coordinator.model),
});

/** content: "generic" pushes only "Fardesk" plus the machine name; "full" adds session titles, summaries and assistant text (they pass Apple's servers). */
const pushSchema = z.strictObject({ content: pushContentSchema.default(CONFIG_DEFAULTS.push.content) });

const ownedSchema = z.strictObject({
  /** The mode of sessions without a mode of their own. "bypassPermissions" needs `allowBypass`. */
  permissionMode: permissionModeSchema.default(CONFIG_DEFAULTS.owned.permissionMode),
  /** Sessions started or resumed through Fardesk may skip permission prompts (bypassPermissions) only while this is true. */
  allowBypass: z.boolean().default(CONFIG_DEFAULTS.owned.allowBypass),
  interruptTimeoutMs: z.number().int().positive().default(CONFIG_DEFAULTS.owned.interruptTimeoutMs),
});

/** Advanced: tailnet login names and tags that may pair although they are not the user of this computer (families, teams). */
const pairingSchema = z.strictObject({
  allowedUsers: z.array(z.string().min(1)).default(CONFIG_DEFAULTS.pairing.allowedUsers),
  allowedTags: z.array(z.string().min(1)).default(CONFIG_DEFAULTS.pairing.allowedTags),
});

const bindSchema = z.strictObject({
  address: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  /** Lets the daemon listen on an address outside the tailnet and loopback; needs `tls` (see bind.ts). */
  allowNonTailnet: z.boolean().default(CONFIG_DEFAULTS.bind.allowNonTailnet),
});

/** scanRoots: where find_folders and the new-session folder search look for projects, each `depth` levels deep (`~` = the home folder). */
const foldersSchema = z.strictObject({ scanRoots: z.array(scanRootSchema).default(CONFIG_DEFAULTS.folders.scanRoots) });

const hubSchema = z.strictObject({
  enabled: z.boolean().default(CONFIG_DEFAULTS.hub.enabled),
  probeMs: z.number().int().positive().default(CONFIG_DEFAULTS.hub.probeMs),
});

export const configSchema = z.strictObject({
  name: z.string().min(1),
  bind: bindSchema.default(CONFIG_DEFAULTS.bind),
  token: z.string().min(MIN_TOKEN_LENGTH),
  tls: z.strictObject({ cert: z.string().min(1), key: z.string().min(1) }).nullable().default(CONFIG_DEFAULTS.tls),
  claudeHomes: z.array(z.string().min(1)).default(CONFIG_DEFAULTS.claudeHomes),
  claudeBinary: z.string().min(1).default(CONFIG_DEFAULTS.claudeBinary),
  stateDir: z.string().min(1).default(CONFIG_DEFAULTS.stateDir),
  models: z.array(z.string().min(1)).default(CONFIG_DEFAULTS.models),
  intervals: z
    .strictObject({
      registryPollMs: z.number().int().positive(),
      transcriptPollMs: z.number().int().positive(),
      pingMs: z.number().int().positive(),
      typablePollMs: z.number().int().positive().default(CONFIG_DEFAULTS.intervals.typablePollMs),
    })
    .default(CONFIG_DEFAULTS.intervals),
  permissionTimeoutSeconds: z.number().int().positive().default(CONFIG_DEFAULTS.permissionTimeoutSeconds),
  activityPageLimit: z
    .strictObject({ default: z.number().int().positive(), max: z.number().int().positive() })
    .default(CONFIG_DEFAULTS.activityPageLimit),
  detail: z
    .strictObject({ maxOutputLines: z.number().int().positive(), maxDiffLines: z.number().int().positive() })
    .default(CONFIG_DEFAULTS.detail),
  owned: ownedSchema.default(CONFIG_DEFAULTS.owned),
  delivery: z
    .strictObject({ timeoutMs: z.number().int().positive(), pollMs: z.number().int().positive() })
    .default(CONFIG_DEFAULTS.delivery),
  kill: z
    .strictObject({ timeoutMs: z.number().int().positive(), pollMs: z.number().int().positive() })
    .default(CONFIG_DEFAULTS.kill),
  summaryMaxChars: z.number().int().positive().default(CONFIG_DEFAULTS.summaryMaxChars),
  notifications: z.array(notificationTypeSchema).default(CONFIG_DEFAULTS.notifications),
  apns: z
    .strictObject({ keyPath: z.string().min(1), keyId: z.string().min(1), teamId: z.string().min(1), topic: z.string().min(1) })
    .nullable()
    .default(CONFIG_DEFAULTS.apns),
  tmuxBinary: z.string().min(1).default(CONFIG_DEFAULTS.tmuxBinary),
  osascriptBinary: z.string().min(1).default(CONFIG_DEFAULTS.osascriptBinary),
  auth: authSchema.default(CONFIG_DEFAULTS.auth),
  pairing: pairingSchema.default(CONFIG_DEFAULTS.pairing),
  peers: z.array(peerSchema).default(CONFIG_DEFAULTS.peers),
  sessions: sessionsSchema.default(CONFIG_DEFAULTS.sessions),
  coordinator: coordinatorSchema.default(CONFIG_DEFAULTS.coordinator),
  push: pushSchema.default(CONFIG_DEFAULTS.push),
  hub: hubSchema.default(CONFIG_DEFAULTS.hub),
  folders: foldersSchema.default(CONFIG_DEFAULTS.folders),
}).superRefine((config, context) => {
  const bypassWithoutPermission = (path: string[]): void => {
    context.addIssue({ code: "custom", path, message: "bypassPermissions needs owned.allowBypass: true" });
  };
  if (config.owned.permissionMode === "bypassPermissions" && !config.owned.allowBypass) bypassWithoutPermission(["owned", "permissionMode"]);
  if (config.coordinator.permissionMode === "bypassPermissions" && !config.owned.allowBypass) bypassWithoutPermission(["coordinator", "permissionMode"]);
});

export type Config = z.infer<typeof configSchema>;

export function expandHome(p: string): string {
  if (p === HOME_PREFIX) return homedir();
  if (p.startsWith(`${HOME_PREFIX}/`)) return join(homedir(), p.slice(HOME_PREFIX.length + 1));
  return p;
}

export function defaultConfigPath(): string {
  return process.env[CONFIG_ENV_VAR] ?? join(homedir(), DEFAULT_CONFIG_RELATIVE);
}

function describeIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

function readJson(path: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new FardeskError("invalid_request", `cannot read config file ${path}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new FardeskError("invalid_request", `config file ${path} is not valid JSON: ${(error as Error).message}`);
  }
}

export function readConfigFile(path: string): Record<string, unknown> {
  const raw = readJson(path);
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new FardeskError("invalid_request", `config file ${path} must hold a JSON object`);
  }
  return raw as Record<string, unknown>;
}

// Rewrites only the given top-level keys, keeps every other key as written, validates the result, atomic + mode 600.
export function updateConfigFile(path: string, patch: Record<string, unknown>): void {
  const merged = { ...readConfigFile(path), ...patch };
  const parsed = configSchema.safeParse(merged);
  if (!parsed.success) throw new FardeskError("invalid_request", `refusing to write invalid config ${path}: ${describeIssues(parsed.error)}`);
  writeJsonState(path, merged);
}

export function writePasswordHash(path: string, passwordHash: string): void {
  const current = readConfigFile(path)["auth"];
  const auth = typeof current === "object" && current !== null && !Array.isArray(current) ? current : {};
  updateConfigFile(path, { auth: { ...auth, passwordHash } });
}

function expandPaths(config: Config): Config {
  return {
    ...config,
    claudeHomes: config.claudeHomes.map(expandHome),
    stateDir: expandHome(config.stateDir),
    tls: config.tls === null ? null : { cert: expandHome(config.tls.cert), key: expandHome(config.tls.key) },
    apns: config.apns === null ? null : { ...config.apns, keyPath: expandHome(config.apns.keyPath) },
    folders: { scanRoots: config.folders.scanRoots.map((root) => ({ ...root, dir: expandHome(root.dir) })) },
  };
}

export function loadConfig(path: string): Config {
  const parsed = configSchema.safeParse(readJson(path));
  if (!parsed.success) {
    throw new FardeskError("invalid_request", `invalid config ${path}: ${describeIssues(parsed.error)}`);
  }
  return expandPaths(parsed.data);
}

export function writeInitialConfig(path: string, name: string): Config {
  if (existsSync(path)) throw new FardeskError("conflict", `config file ${path} already exists`);
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  writeFileSync(path, `${JSON.stringify({ name, token }, null, 2)}\n`, { mode: FILE_MODE, flag: "wx" });
  return loadConfig(path);
}
