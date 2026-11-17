import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixturePath, makeTempDir } from "../../test/support/env.js";
import { readClaudeRegistry } from "./claudeRegistry.js";

const children: ChildProcess[] = [];
afterAll(() => {
  for (const child of children) child.kill();
});

function spawnLive(): number {
  const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"]);
  children.push(child);
  if (child.pid === undefined) throw new Error("child did not start");
  return child.pid;
}

function deadPid(): number {
  const finished = spawnSync(process.execPath, ["-e", ""]);
  return finished.pid;
}

function fixtureWithPid(name: string, pid: number): string {
  const raw = JSON.parse(readFileSync(fixturePath("registry", name), "utf8")) as Record<string, unknown>;
  return JSON.stringify({ ...raw, pid });
}

function sessionsDir(home: string): string {
  const dir = join(home, "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function put(home: string, pid: number, content: string): void {
  writeFileSync(join(sessionsDir(home), `${pid}.json`), content);
}

describe("readClaudeRegistry", () => {
  it("returns live processes sorted by pid and maps every field", () => {
    const home = makeTempDir();
    const live = [spawnLive(), spawnLive(), process.pid].sort((a, b) => a - b);
    const names = ["idle.json", "busy.json", "shell.json"] as const;
    live.forEach((pid, index) => { put(home, pid, fixtureWithPid(names[index] ?? "idle.json", pid)); });
    const result = readClaudeRegistry(home);
    expect(result.processes.map((p) => p.pid)).toEqual(live);
    expect(result.skipped).toEqual({ invalidJson: 0, invalidShape: 0, dead: 0 });
    expect(result.processes[0]).toEqual({
      pid: live[0],
      sessionId: "11111111-1111-4111-8111-111111111111",
      cwd: "/Users/dev/alpha",
      status: "idle",
      name: "alpha-task",
      kind: "interactive",
      entrypoint: "cli",
      tmux: null,
      messagingSocketPath: "/tmp/cc-socks/38521.sock",
      waitingFor: null,
      startedAt: 1794741443560,
      updatedAt: 1794749559566,
    });
  });

  it("maps waiting, tmux and sdk-ts fixtures", () => {
    const home = makeTempDir();
    const [a, b, c] = [spawnLive(), spawnLive(), spawnLive()] as [number, number, number];
    put(home, a, fixtureWithPid("constructed-waiting.json", a));
    put(home, b, fixtureWithPid("constructed-tmux.json", b));
    put(home, c, fixtureWithPid("constructed-sdk-ts.json", c));
    const byPid = new Map(readClaudeRegistry(home).processes.map((p) => [p.pid, p]));
    expect(byPid.get(a)).toMatchObject({ status: "waiting", waitingFor: "permission prompt" });
    expect(byPid.get(b)).toMatchObject({ tmux: "mysession:@0.%0" });
    expect(byPid.get(c)).toMatchObject({ entrypoint: "sdk-ts", kind: "bg", name: null, messagingSocketPath: null });
  });

  it("counts dead, invalid json and invalid shape entries and ignores other files", () => {
    const home = makeTempDir();
    const dead = deadPid();
    put(home, dead, fixtureWithPid("busy.json", dead));
    put(home, 1001, '{"pid":1001,"sessionId":');
    put(home, 1002, JSON.stringify({ pid: process.pid }));
    put(home, 1003, "[]");
    const dir = sessionsDir(home);
    writeFileSync(join(dir, "1004.abcdef.key"), "SECRET");
    writeFileSync(join(dir, "notes.json"), "{}");
    writeFileSync(join(dir, "1005.json.tmp"), "{}");
    const result = readClaudeRegistry(home);
    expect(result.processes).toEqual([]);
    expect(result.skipped).toEqual({ invalidJson: 1, invalidShape: 2, dead: 1 });
  });

  it("uses the injected liveness check", () => {
    const home = makeTempDir();
    put(home, 1, fixtureWithPid("idle.json", 4_000_000));
    expect(readClaudeRegistry(home, () => true).processes).toHaveLength(1);
    expect(readClaudeRegistry(home, () => false).skipped.dead).toBe(1);
  });

  it("returns an empty result when the sessions dir is missing", () => {
    const result = readClaudeRegistry(makeTempDir());
    expect(result).toEqual({ processes: [], skipped: { invalidJson: 0, invalidShape: 0, dead: 0 } });
  });

  it("skips a file that vanishes between listing and reading", () => {
    const home = makeTempDir();
    symlinkSync(join(home, "gone"), join(sessionsDir(home), "77.json"));
    expect(readClaudeRegistry(home).processes).toEqual([]);
  });

  it("rethrows unexpected read errors", () => {
    const home = makeTempDir();
    mkdirSync(join(sessionsDir(home), "88.json"));
    expect(() => readClaudeRegistry(home)).toThrow(/EISDIR/);
  });

  it("rethrows unexpected directory errors", () => {
    const home = makeTempDir();
    writeFileSync(join(home, "sessions"), "not a dir");
    expect(() => readClaudeRegistry(home)).toThrow(/ENOTDIR/);
  });
});
