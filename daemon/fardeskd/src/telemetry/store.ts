// Error and event reports from the apps: one JSON line each in <stateDir>/telemetry.jsonl, rotated to telemetry.1.jsonl past 20 MB.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { telemetryReportSchema } from "../contract/schema.js";
import type { TelemetryReport } from "../contract/schema.js";

export const TELEMETRY_FILE = "telemetry.jsonl";
export const TELEMETRY_ROTATED_FILE = "telemetry.1.jsonl";
export const TELEMETRY_MAX_BYTES = 20_000_000;
export const DEFAULT_TELEMETRY_LIMIT = 100;
export const MAX_TELEMETRY_LIMIT = 1000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type TelemetryStore = {
  /** Stores the reports whose id is new; resolves to how many were stored and how many were already known. */
  append(reports: TelemetryReport[]): { accepted: number; duplicates: number };
  /** Newest first, only reports at or after `since`. */
  list(query: { since?: string | undefined; limit?: number | undefined; kind?: "error" | "event" | undefined }): TelemetryReport[];
};

export type TelemetryStoreOptions = { dir: string; maxBytes?: number };

function readReports(path: string): TelemetryReport[] {
  if (!existsSync(path)) return [];
  const reports: TelemetryReport[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.length === 0) continue;
    try {
      const parsed = telemetryReportSchema.safeParse(JSON.parse(line));
      if (parsed.success) reports.push(parsed.data);
    } catch {
      continue;
    }
  }
  return reports;
}

function rotateWhenFull(current: string, rotated: string, maxBytes: number): void {
  if (existsSync(current) && statSync(current).size > maxBytes) renameSync(current, rotated);
}

export function createTelemetryStore(options: TelemetryStoreOptions): TelemetryStore {
  const { dir, maxBytes = TELEMETRY_MAX_BYTES } = options;
  const current = join(dir, TELEMETRY_FILE);
  const rotated = join(dir, TELEMETRY_ROTATED_FILE);
  const readAll = (): TelemetryReport[] => [...readReports(rotated), ...readReports(current)];
  const known = new Set(readAll().map((report) => report.id));

  return {
    append(reports): { accepted: number; duplicates: number } {
      mkdirSync(dir, { recursive: true, mode: DIR_MODE });
      let accepted = 0;
      for (const report of reports) {
        if (known.has(report.id)) continue;
        rotateWhenFull(current, rotated, maxBytes);
        appendFileSync(current, `${JSON.stringify(report)}\n`, { mode: FILE_MODE });
        known.add(report.id);
        accepted += 1;
      }
      return { accepted, duplicates: reports.length - accepted };
    },
    list({ since, limit = DEFAULT_TELEMETRY_LIMIT, kind }): TelemetryReport[] {
      const floor = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since);
      return readAll()
        .filter((report) => Date.parse(report.at) >= floor)
        .filter((report) => kind === undefined || (report.kind ?? "error") === kind)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
        .slice(0, limit);
    },
  };
}
