// Append-only audit log (audit.jsonl, mode 600): who did what, never any message text. Rotates at a fixed size.
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

export const AUDIT_FILE = "audit.jsonl";
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
  const path = join(options.stateDir, AUDIT_FILE);
  const now = options.now ?? ((): Date => new Date());
  const maxBytes = options.maxBytes ?? AUDIT_MAX_BYTES;
  return {
    record(input): void {
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

/** The rotated file first, then the current one; entries older than `since` are skipped. */
export function readAudit(stateDir: string, since: Date | null): AuditEntry[] {
  const path = join(stateDir, AUDIT_FILE);
  const lines = [...readLines(`${path}${ROTATED_SUFFIX}`), ...readLines(path)];
  const entries = lines.map((line) => auditEntrySchema.parse(JSON.parse(line)));
  return since === null ? entries : entries.filter((entry) => new Date(entry.time) >= since);
}
