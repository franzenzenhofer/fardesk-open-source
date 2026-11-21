import { rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startApnsServer, createTestApnsClient } from "../../test/support/apnsServer.js";
import type { ApnsTestServer } from "../../test/support/apnsServer.js";
import { createClaudeHome } from "../../test/support/claudeHome.js";
import type { ClaudeHome } from "../../test/support/claudeHome.js";
import { makeTempDir, sleep } from "../../test/support/env.js";
import { quietStoreDeps } from "../../test/support/storeDeps.js";
import { createBus } from "../core/bus.js";
import { createLogger } from "../core/log.js";
import { createDeviceStore } from "../push/deviceStore.js";
import { createNotifier } from "../push/notifier.js";
import type { Notifier } from "../push/notifier.js";
import { AUTOMATION_ROOTS_ENV, isAutomationCwd, isAutomationProjectDir } from "./automation.js";
import { createSessionStore } from "./store.js";
import type { SessionStore } from "./store.js";

const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "aa".repeat(32);
const savedRoots = process.env[AUTOMATION_ROOTS_ENV];

const homes: ClaudeHome[] = [];
const stores: SessionStore[] = [];
const notifiers: Notifier[] = [];
const servers: ApnsTestServer[] = [];

beforeEach(() => {
  Reflect.deleteProperty(process.env, AUTOMATION_ROOTS_ENV);
});

afterEach(async () => {
  if (savedRoots === undefined) Reflect.deleteProperty(process.env, AUTOMATION_ROOTS_ENV);
  else process.env[AUTOMATION_ROOTS_ENV] = savedRoots;
  for (const notifier of notifiers.splice(0)) notifier.close();
  for (const store of stores.splice(0)) store.close();
  for (const home of homes.splice(0)) home.dispose();
  for (const server of servers.splice(0)) await server.stop();
});

describe("the automation roots", () => {
  it("treat the system temp folders, in any spelling, as automation", () => {
    expect(isAutomationCwd(join(tmpdir(), "fd-test", "work"))).toBe(true);
    expect(isAutomationCwd("/private/var/folders/ab/cd/T/work")).toBe(true);
    expect(isAutomationCwd("/var/folders/ab/cd/T/work")).toBe(true);
    expect(isAutomationCwd("/tmp/work")).toBe(true);
    expect(isAutomationCwd("/private/tmp")).toBe(true);
  });

  it("do not match real projects or folders that only share a name prefix", () => {
    expect(isAutomationCwd("/Users/dev/project")).toBe(false);
    expect(isAutomationCwd("/tmpfoo/work")).toBe(false);
    expect(isAutomationCwd("/Users/dev/tmp/work")).toBe(false);
  });

  it("follow symlinks into a temp folder", () => {
    const link = join(makeTempDir("fd-link-"), "link");
    process.env[AUTOMATION_ROOTS_ENV] = makeTempDir("fd-root-");
    const target = process.env[AUTOMATION_ROOTS_ENV];
    symlinkSync(target, link);
    expect(isAutomationCwd(join(link, "gone", "work"))).toBe(true);
  });

  it("read the override list and recognise the encoded project folder name", () => {
    process.env[AUTOMATION_ROOTS_ENV] = ["/work/runs", "/other"].join(delimiter);
    expect(isAutomationCwd("/work/runs/a")).toBe(true);
    expect(isAutomationCwd(tmpdir())).toBe(false);
    expect(isAutomationProjectDir("/home/dev/projects/-work-runs-a")).toBe(true);
    expect(isAutomationProjectDir("/home/dev/projects/-work-project")).toBe(false);
    expect(isAutomationProjectDir("/home/dev/projects/-work-runsfoo")).toBe(false);
  });

  it("know a private macOS temp project folder name", () => {
    expect(isAutomationProjectDir("/c/projects/-private-var-folders-ab-cd-T-fdh-x")).toBe(true);
  });
});

type Run = { pushes: number; listed: string[]; logs: string[] };

/** One real session lifecycle: live in `cwd`, then its process ends. Counts the pushes the phone gets. */
async function lifecycle(cwd: string, projectDir: string): Promise<Run> {
  const server = await startApnsServer();
  servers.push(server);
  const home = createClaudeHome();
  homes.push(home);
  home.addTranscript({ fixture: "01-simple-session", sessionId: SESSION_ID, projectDir });
  const live = home.addRegistry({ fixture: "idle", sessionId: SESSION_ID, overrides: { cwd } });
  const bus = createBus();
  const logs: string[] = [];
  const log = createLogger((line) => logs.push(line), () => new Date());
  const devices = createDeviceStore(join(makeTempDir(), "devices.json"), () => new Date());
  devices.upsert({ apnsToken: TOKEN, environment: "sandbox", name: "iPhone", notifications: ["ended"] });
  // The notifier listens before the store's first scan, as in the daemon, so it sees the session live first.
  notifiers.push(
    createNotifier({
      bus, apns: createTestApnsClient(server), devices, describe: () => ({ title: "t", summary: "s" }), isMuted: () => false,
      notificationsEnabled: ["ended"], machineName: "mac", content: "full", log,
    }),
  );
  const store = createSessionStore(quietStoreDeps(home.dir, { bus, log }));
  stores.push(store);
  const listed = store.list().map((session) => session.id);
  await home.killLive(live.pid);
  store.refresh();
  await sleep(300);
  return { pushes: server.requests.length, listed, logs };
}

describe("a session lifecycle", () => {
  it("in an automation folder is not listed and sends no push when it ends", async () => {
    const root = makeTempDir("fd-auto-");
    process.env[AUTOMATION_ROOTS_ENV] = root;
    const run = await lifecycle(join(root, "work"), `${root.replace(/[^A-Za-z0-9]/g, "-")}-work`);
    expect(run.listed).toEqual([]);
    expect(run.pushes).toBe(0);
    expect(run.logs).toEqual([]);
  });

  it("in a normal folder is listed and pushes when it ends", async () => {
    process.env[AUTOMATION_ROOTS_ENV] = makeTempDir("fd-auto-");
    const run = await lifecycle(makeTempDir("fd-real-"), "-work-project");
    expect(run.listed).toEqual([SESSION_ID]);
    expect(run.pushes).toBe(1);
  });
});

describe("a transcript that disappears between the scan and the read", () => {
  it("is quietly treated as gone: no error, no session", () => {
    const home = createClaudeHome();
    homes.push(home);
    const { path } = home.addTranscript({ fixture: "01-simple-session", sessionId: SESSION_ID });
    const logs: string[] = [];
    const base = quietStoreDeps(home.dir, { log: createLogger((line) => logs.push(line), () => new Date()) });
    // The reads budget is looked up after the scan and before the first read: the folder is trashed right there.
    const limits = {
      ...base.limits,
      get maxEndedReadsPerRefresh(): number {
        rmSync(path, { force: true });
        return 10;
      },
    };
    const store = createSessionStore({ ...base, limits });
    stores.push(store);
    expect(store.list()).toEqual([]);
    store.refresh();
    expect(logs).toEqual([]);
  });
});
