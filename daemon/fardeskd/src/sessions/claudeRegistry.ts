import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { errorCode, isProcessAlive } from "./processes.js";

const REGISTRY_FILE = /^\d+\.json$/;

export const liveProcessSchema = z.looseObject({
  pid: z.number().int().positive(),
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  status: z.string().min(1),
  kind: z.string().min(1),
  entrypoint: z.string().min(1),
  startedAt: z.number(),
  updatedAt: z.number(),
  name: z.string().nullish(),
  tmux: z.string().nullish(),
  messagingSocketPath: z.string().nullish(),
  waitingFor: z.string().nullish(),
});

export type LiveProcess = {
  pid: number;
  sessionId: string;
  cwd: string;
  status: "busy" | "idle" | "waiting" | "shell" | (string & {});
  name: string | null;
  kind: string;
  entrypoint: string;
  tmux: string | null;
  messagingSocketPath: string | null;
  waitingFor: string | null;
  startedAt: number;
  updatedAt: number;
};

export type RegistrySkipCounts = { invalidJson: number; invalidShape: number; dead: number };
export type RegistryReadResult = { processes: LiveProcess[]; skipped: RegistrySkipCounts };

function toLiveProcess(parsed: z.infer<typeof liveProcessSchema>): LiveProcess {
  return {
    pid: parsed.pid,
    sessionId: parsed.sessionId,
    cwd: parsed.cwd,
    status: parsed.status,
    name: parsed.name ?? null,
    kind: parsed.kind,
    entrypoint: parsed.entrypoint,
    tmux: parsed.tmux ?? null,
    messagingSocketPath: parsed.messagingSocketPath ?? null,
    waitingFor: parsed.waitingFor ?? null,
    startedAt: parsed.startedAt,
    updatedAt: parsed.updatedAt,
  };
}

function listRegistryFiles(sessionsDir: string): string[] {
  try {
    return readdirSync(sessionsDir).filter((name) => REGISTRY_FILE.test(name));
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

function readFileIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function readClaudeRegistry(claudeHome: string, isAlive: (pid: number) => boolean = isProcessAlive): RegistryReadResult {
  const sessionsDir = join(claudeHome, "sessions");
  const skipped: RegistrySkipCounts = { invalidJson: 0, invalidShape: 0, dead: 0 };
  const processes: LiveProcess[] = [];
  for (const name of listRegistryFiles(sessionsDir)) {
    const text = readFileIfPresent(join(sessionsDir, name));
    if (text === null) continue;
    const json = parseJson(text);
    if (json === undefined) {
      skipped.invalidJson += 1;
      continue;
    }
    const parsed = liveProcessSchema.safeParse(json);
    if (!parsed.success) {
      skipped.invalidShape += 1;
      continue;
    }
    if (!isAlive(parsed.data.pid)) {
      skipped.dead += 1;
      continue;
    }
    processes.push(toLiveProcess(parsed.data));
  }
  return { processes: processes.sort((a, b) => a.pid - b.pid), skipped };
}
