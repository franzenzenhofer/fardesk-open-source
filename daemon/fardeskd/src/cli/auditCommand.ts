// `fardeskd audit [--since <time>]`: prints the audit log, one line per entry.
import { readAudit } from "../audit/store.js";
import type { AuditEntry } from "../audit/store.js";
import { loadConfig } from "../config/config.js";
import { FardeskError } from "../core/errors.js";
import { EXIT_OK } from "./types.js";
import type { CommandContext } from "./types.js";

const SPAN = /^(\d+)([mhd])$/;
const MS_PER_UNIT: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** "30m", "2h", "7d" count back from `now`; anything else must be an ISO time. */
export function parseSince(text: string, now: Date): Date {
  const span = SPAN.exec(text);
  if (span !== null) return new Date(now.getTime() - Number(span[1]) * (MS_PER_UNIT[span[2] ?? ""] ?? 0));
  const time = new Date(text);
  if (Number.isNaN(time.getTime())) throw new FardeskError("invalid_request", `--since needs an ISO time or a span like 30m, 2h, 7d, got ${JSON.stringify(text)}`);
  return time;
}

export function formatAuditLine(entry: AuditEntry): string {
  const who = entry.deviceId ?? "-";
  const session = entry.sessionId ?? "-";
  return `${entry.time} ${entry.event} device=${who} ${entry.method} ${entry.route} session=${session} result=${entry.result} ip=${entry.ip}`;
}

export function runAudit(context: CommandContext): number {
  const { stateDir } = loadConfig(context.configPath);
  const since = context.since === null ? null : parseSince(context.since, context.now());
  for (const entry of readAudit(stateDir, since)) context.io.stdout(formatAuditLine(entry));
  return EXIT_OK;
}
