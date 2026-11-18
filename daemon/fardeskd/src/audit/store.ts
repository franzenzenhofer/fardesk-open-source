// Append-only audit log (audit.jsonl, mode 600): who did what, never any message text. Rotates at a fixed size.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const AUDIT_FILE = "audit.jsonl";
/** Rejected logins, pairings and bearers (no device id), rotated on their own. */
export const UNAUTHENTICATED_AUDIT_FILE = "audit-unauthenticated.jsonl";
export const AUDIT_MAX_BYTES = 1_000_000;
const FILE_MODE = 0o600;
const DIR_MODE = 0o700;
const ROTATED_SUFFIX = ".1";

export const auditEntrySchema = z.strictObject({
  time: z.iso.datetime(),
  /** `login_failed` is a rejected login or pairing attempt; `request` is every other state-changing call. */
  event: z.enum(["request", "login_failed"]),
  deviceId: z.string().min(1).nullable(),
  method: z.string().min(1),
  route: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  result: z.number().int(),
  ip: z.string().min(1),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;
export type AuditInput = Omit<AuditEntry, "time">;

export type AuditLog = { record(input: AuditInput): void };

export type AuditOptions = { stateDir: string; now?: () => Date; maxBytes?: number };

function rotateWhenFull(path: string, maxBytes: number): void {
  if (existsSync(path) && statSync(path).size >= maxBytes) renameSync(path, `${path}${ROTATED_SUFFIX}`);
}

export function createAuditLog(options: AuditOptions): AuditLog {
  const now = options.now ?? ((): Date => new Date());
  const maxBytes = options.maxBytes ?? AUDIT_MAX_BYTES;
  return {
    record(input): void {
      // Callers without a valid bearer get their own file: flooding it cannot rotate the authenticated trail away.
      const path = join(options.stateDir, input.deviceId === null ? UNAUTHENTICATED_AUDIT_FILE : AUDIT_FILE);
      mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
      rotateWhenFull(path, maxBytes);
      const entry: AuditEntry = { time: now().toISOString(), ...input };
      appendFileSync(path, `${JSON.stringify(entry)}\n`, { mode: FILE_MODE });
      chmodSync(path, FILE_MODE);
    },
  };
}

function readLines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line !== "") : [];
}

function readFile(stateDir: string, file: string): AuditEntry[] {
  const path = join(stateDir, file);
  return [...readLines(`${path}${ROTATED_SUFFIX}`), ...readLines(path)].map((line) => auditEntrySchema.parse(JSON.parse(line)));
}

/** Both logs merged in time order (each: the rotated file first, then the current one); entries older than `since` are skipped. */
export function readAudit(stateDir: string, since: Date | null): AuditEntry[] {
  const entries = [...readFile(stateDir, AUDIT_FILE), ...readFile(stateDir, UNAUTHENTICATED_AUDIT_FILE)]
    .sort((left, right) => left.time.localeCompare(right.time));
  return since === null ? entries : entries.filter((entry) => new Date(entry.time) >= since);
}
