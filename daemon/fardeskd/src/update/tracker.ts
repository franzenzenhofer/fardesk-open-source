// The state of the last self-update, kept in a small JSON file so the next daemon process (after the restart the installer causes) can report it.
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { z } from "zod";
import { updateStateSchema } from "../contract/schema.js";
import { readJsonState, writeJsonState } from "../core/jsonState.js";
import type { UpdatePaths } from "./paths.js";

const recordSchema = z.object({ state: updateStateSchema, message: z.string().nullable(), version: z.string().nullable(), at: z.iso.datetime().nullable() });

export type UpdateRecord = z.infer<typeof recordSchema>;

const IDLE: UpdateRecord = { state: "idle", message: null, version: null, at: null };
const MAX_MESSAGE_CHARS = 300;
/** An installer that has not finished (and not failed) after this long is taken as dead. */
export const DEFAULT_STALE_MS = 15 * 60_000;

export type UpdateTracker = {
  current(): UpdateRecord;
  /** A new update with this target version starts: clears the old log and exit code. */
  begin(version: string): void;
  fail(message: string): void;
};

export type TrackerOptions = { paths: UpdatePaths; ownVersion: string; now: () => Date; staleMs: number };

function readExitCode(path: string): number | null {
  if (!existsSync(path)) return null;
  const code = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  return Number.isNaN(code) ? null : code;
}

function lastLogLine(path: string): string | null {
  if (!existsSync(path)) return null;
  const lines = readFileSync(path, "utf8").split("\n").map((line) => line.trim()).filter((line) => line !== "");
  const last = lines.at(-1);
  return last === undefined ? null : last.slice(0, MAX_MESSAGE_CHARS);
}

type Writer = { save(state: UpdateRecord["state"], message: string | null, version: string | null): UpdateRecord };

/** A running update that has failed (exit code, stale) is turned into `failed`; otherwise it stays as it is. */
function checkRunning(record: UpdateRecord, { paths, now, staleMs }: TrackerOptions, write: Writer): UpdateRecord {
  const code = readExitCode(paths.exitFile);
  if (code !== null && code !== 0) return write.save("failed", lastLogLine(paths.logFile) ?? `the installer exited with code ${code}`, record.version);
  const started = record.at === null ? now().getTime() : Date.parse(record.at);
  if (now().getTime() - started > staleMs) return write.save("failed", `the installer did not finish within ${Math.round(staleMs / 60_000)} minutes`, record.version);
  return record;
}

export function createTracker(options: TrackerOptions): UpdateTracker {
  const { paths, ownVersion, now } = options;
  const write: Writer = {
    save(state, message, version): UpdateRecord {
      const next = { state, message, version, at: now().toISOString() };
      writeJsonState(paths.stateFile, next);
      return next;
    },
  };
  // The new daemon process starts here: a running update whose target is this very version has succeeded.
  let record = readJsonState(paths.stateFile, recordSchema, "update state", IDLE);
  if (record.state === "running" && record.version === ownVersion) record = write.save("done", null, record.version);
  return {
    current(): UpdateRecord {
      if (record.state === "running") record = checkRunning(record, options, write);
      return record;
    },
    begin(version): void {
      mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
      rmSync(paths.exitFile, { force: true });
      rmSync(paths.logFile, { force: true });
      record = write.save("running", null, version);
    },
    fail(message): void {
      record = write.save("failed", message, record.version);
    },
  };
}

