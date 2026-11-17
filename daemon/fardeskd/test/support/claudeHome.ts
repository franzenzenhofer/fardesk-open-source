// Builds a real temporary Claude home (projects/<dir>/<uuid>.jsonl, sessions/<pid>.json) from the fixtures.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { appendFileSync, copyFileSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fixturePath, makeTempDir } from "./env.js";

const LIVE_CHILD_SCRIPT = "setTimeout(() => {}, 120000)";
const DEFAULT_PROJECT_DIR = "-work-project";

export type TranscriptOptions = { fixture: string; sessionId?: string; projectDir?: string };
export type RegistryOptions = { fixture: string; sessionId: string; pid?: number; overrides?: Record<string, unknown> };

export type ClaudeHome = {
  dir: string;
  addTranscript(options: TranscriptOptions): { sessionId: string; path: string };
  addRegistry(options: RegistryOptions): { pid: number; path: string };
  removeRegistry(pid: number): void;
  appendLine(path: string, raw: string): void;
  setMtime(path: string, when: Date): void;
  spawnLive(): number;
  killLive(pid: number): Promise<void>;
  deadPid(): number;
  dispose(): void;
};

type Children = Map<number, ChildProcess>;

function spawnLiveChild(children: Children): number {
  const child = spawn(process.execPath, ["-e", LIVE_CHILD_SCRIPT], { stdio: "ignore" });
  if (child.pid === undefined) throw new Error("child did not start");
  children.set(child.pid, child);
  return child.pid;
}

async function killChild(children: Children, pid: number): Promise<void> {
  const child = children.get(pid);
  if (child === undefined) throw new Error(`pid ${pid} was not spawned by this home`);
  const exited = new Promise<void>((resolve) => child.once("exit", () => { resolve(); }));
  child.kill("SIGKILL");
  await exited;
}

function copyTranscript(dir: string, { fixture, sessionId = randomUUID(), projectDir = DEFAULT_PROJECT_DIR }: TranscriptOptions): { sessionId: string; path: string } {
  const target = join(dir, "projects", projectDir);
  mkdirSync(target, { recursive: true });
  const path = join(target, `${sessionId}.jsonl`);
  copyFileSync(fixturePath("transcripts", `${fixture}.jsonl`), path);
  return { sessionId, path };
}

function writeRegistry(dir: string, pid: number, options: RegistryOptions): { pid: number; path: string } {
  const raw = JSON.parse(readFileSync(fixturePath("registry", `${options.fixture}.json`), "utf8")) as Record<string, unknown>;
  const path = join(dir, "sessions", `${pid}.json`);
  writeFileSync(path, JSON.stringify({ ...raw, ...options.overrides, pid, sessionId: options.sessionId }));
  return { pid, path };
}

export function createClaudeHome(): ClaudeHome {
  const dir = makeTempDir("fdh-");
  const children: Children = new Map();
  mkdirSync(join(dir, "sessions"), { recursive: true });
  return {
    dir,
    addTranscript: (options) => copyTranscript(dir, options),
    addRegistry: (options) => writeRegistry(dir, options.pid ?? spawnLiveChild(children), options),
    removeRegistry(pid): void {
      rmSync(join(dir, "sessions", `${pid}.json`), { force: true });
    },
    appendLine(path, raw): void {
      appendFileSync(path, `${raw}\n`);
    },
    setMtime(path, when): void {
      utimesSync(path, when, when);
    },
    spawnLive: () => spawnLiveChild(children),
    killLive: async (pid) => killChild(children, pid),
    deadPid: () => spawnSync(process.execPath, ["-e", ""]).pid,
    dispose(): void {
      for (const child of children.values()) child.kill("SIGKILL");
    },
  };
}
