// The self-update of one daemon: features, the package it serves, and the update it takes (a real installer script runs).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntilAsync } from "../../test/support/env.js";
import { installDirWith, makeRelease, scriptInstaller } from "../../test/support/release.js";
import type { Release } from "../../test/support/release.js";
import { FEATURES } from "../contract/features.js";
import { errorResponseSchema, machineSchema, machineUpdateResultSchema } from "../contract/schema.js";
import { sha256Hex } from "./ownPackage.js";
import { createUpdater } from "./updater.js";

let daemon: TestDaemon | null = null;

afterEach(async () => {
  await daemon?.close();
  daemon = null;
});

const AUTH = { authorization: `Bearer ${TEST_TOKEN}` };
const machine = async (target: TestDaemon): Promise<ReturnType<typeof machineSchema.parse>> => machineSchema.parse((await target.call("GET", "/v1/machine")).json);

async function postUpdate(target: TestDaemon, body: Uint8Array, sha256: string | null): Promise<Response> {
  const headers: Record<string, string> = { ...AUTH, "content-type": "application/gzip", ...(sha256 === null ? {} : { "x-fardesk-package-sha256": sha256 }) };
  return target.fetch("/v1/machine/update", { method: "POST", headers, body: Buffer.from(body) });
}

describe("GET /v1/machine: features and update", () => {
  it("lists the feature names and an idle update without a package on a machine installed without one", async () => {
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(null) } });
    const facts = await machine(daemon);
    expect(facts.contractVersion).toBe(4);
    expect(facts.features).toEqual([...FEATURES]);
    expect(facts.features).toEqual(expect.arrayContaining(["chat-image", "self-update", "cold-last-turn"]));
    expect(facts.update).toEqual({ state: "idle", message: null, version: null, packageSha256: null, at: null });
  });

  it("carries the SHA-256 of the installed release package", async () => {
    const release = makeRelease("4.2.0");
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(release) } });
    expect((await machine(daemon)).update.packageSha256).toBe(release.sha256);
  });
});

describe("GET /v1/update/package", () => {
  it("streams the installed release package as application/gzip", async () => {
    const release = makeRelease("4.2.0");
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(release) } });
    const response = await daemon.fetch("/v1/update/package", { headers: AUTH });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/gzip");
    expect(Buffer.from(await response.arrayBuffer()).equals(release.bytes)).toBe(true);
  });

  it("answers 404 not_found when the install has no package, and 401 without a token", async () => {
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(null) } });
    const missing = await daemon.fetch("/v1/update/package", { headers: AUTH });
    expect(missing.status).toBe(404);
    expect(errorResponseSchema.parse(await missing.json()).error.code).toBe("not_found");
    expect((await daemon.fetch("/v1/update/package")).status).toBe(401);
  });
});

describe("POST /v1/machine/update", () => {
  const start = async (exitCode: number, outputLine: string): Promise<{ target: TestDaemon; script: ReturnType<typeof scriptInstaller>; release: Release }> => {
    const script = scriptInstaller(exitCode, outputLine);
    const target = await startTestDaemon({}, { update: { installDir: installDirWith(null), installer: script.installer } });
    daemon = target;
    return { target, script, release: makeRelease("9.9.9") };
  };

  it("refuses a wrong or missing hash and a body that is no release package", async () => {
    const { target, release } = await start(0, "");
    const wrong = await postUpdate(target, release.bytes, "0".repeat(64));
    expect(wrong.status).toBe(400);
    expect(errorResponseSchema.parse(await wrong.json()).error.code).toBe("invalid_request");
    expect((await postUpdate(target, release.bytes, null)).status).toBe(400);
    expect((await postUpdate(target, release.bytes, "not-a-hash")).status).toBe(400);
    const garbage = Buffer.from("this is not a tarball");
    const refused = await postUpdate(target, garbage, sha256Hex(garbage));
    expect(refused.status).toBe(400);
    expect((await machine(target)).update.state).toBe("idle");
  });

  it("runs the installer with the unpacked package, answers at once, and a second update while it runs is a 409", async () => {
    const { target, script, release } = await start(0, "installing");
    const answer = await postUpdate(target, release.bytes, release.sha256);
    expect(answer.status).toBe(200);
    expect(machineUpdateResultSchema.parse(await answer.json())).toEqual({ ok: true, state: "running" });
    const ran = await script.ran();
    expect(ran.packageVersion).toBe("9.9.9");
    expect(ran.packageDir).toContain("unpacked");
    const running = (await machine(target)).update;
    expect(running).toMatchObject({ state: "running", message: null, version: "9.9.9" });
    const second = await postUpdate(target, release.bytes, release.sha256);
    expect(second.status).toBe(409);
    expect(errorResponseSchema.parse(await second.json()).error.code).toBe("conflict");
  });

  it("is done when the next daemon process starts at the new version, and failed while it still runs the old one", async () => {
    const { target, script, release } = await start(0, "installing");
    await postUpdate(target, release.bytes, release.sha256);
    await script.ran();
    const stateDir = target.config.stateDir;
    const nextProcess = (ownVersion: string): ReturnType<typeof createUpdater> => createUpdater({ stateDir, machineName: "test-mac", ownVersion, installDir: installDirWith(null) });
    expect(nextProcess("4.2.0").status()).toMatchObject({ state: "running", version: "9.9.9" });
    expect(nextProcess("9.9.9").status()).toMatchObject({ state: "done", message: null, version: "9.9.9" });
  });

  it("reports failed with the last line of the installer output when the installer exits non-zero", async () => {
    const { target, release } = await start(3, "npm ci failed: network unreachable");
    expect((await postUpdate(target, release.bytes, release.sha256)).status).toBe(200);
    await waitUntilAsync(async () => (await machine(target)).update.state === "failed");
    expect((await machine(target)).update).toMatchObject({ state: "failed", message: "npm ci failed: network unreachable", version: "9.9.9" });
    expect((await postUpdate(target, release.bytes, release.sha256)).status).toBe(200);
  });

  it("fails an installer that never finishes once it is stale", async () => {
    const script = scriptInstaller(0, "");
    const clock = { now: new Date() };
    const target = await startTestDaemon({}, { update: { installDir: installDirWith(null), installer: script.installer, now: () => clock.now, staleMs: 60_000 } });
    daemon = target;
    const release = makeRelease("9.9.9");
    await postUpdate(target, release.bytes, release.sha256);
    expect((await machine(target)).update.state).toBe("running");
    clock.now = new Date(clock.now.getTime() + 61_000);
    expect((await machine(target)).update).toMatchObject({ state: "failed", message: "the installer did not finish within 1 minutes" });
  });

  it("reports failed when the installer program does not exist", async () => {
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(null), installer: () => ({ command: "/no/such/program", args: [] }) } });
    const release = makeRelease("9.9.9");
    expect((await postUpdate(daemon, release.bytes, release.sha256)).status).toBe(200);
    const target = daemon;
    await waitUntilAsync(async () => (await machine(target)).update.state === "failed");
    expect((await machine(target)).update.message).toContain("/no/such/program");
  });

  it("the release installer copies the package over the install folder, keeps it as release.tgz and runs install-local.sh there", async () => {
    const installDir = installDirWith(null);
    const marker = join(installDir, "installed-as");
    const release = makeRelease("9.9.9", `#!/bin/sh\nprintf '%s %s' "$1" "$FARDESK_LABEL" > "${marker}"\n`);
    process.env["FARDESK_LABEL"] = "com.example.fardeskd";
    try {
      daemon = await startTestDaemon({ name: "Linux Box" }, { update: { installDir } });
      expect((await postUpdate(daemon, release.bytes, release.sha256)).status).toBe(200);
      const target = daemon;
      await waitUntilAsync(async () => Promise.resolve(existsSync(marker)));
      expect(readFileSync(marker, "utf8")).toBe("Linux Box com.example.fardeskd");
      expect(readFileSync(join(installDir, "package.json"), "utf8")).toContain("9.9.9");
      expect(Buffer.from(readFileSync(join(installDir, "release.tgz"))).equals(release.bytes)).toBe(true);
      expect((await machine(target)).update.packageSha256).toBe(release.sha256);
    } finally {
      delete process.env["FARDESK_LABEL"];
    }
  });

  it("refuses to start without the service label an installed daemon always has", async () => {
    daemon = await startTestDaemon({}, { update: { installDir: installDirWith(null) } });
    const release = makeRelease("9.9.9");
    const refused = await postUpdate(daemon, release.bytes, release.sha256);
    expect(refused.status).toBe(501);
    expect((await machine(daemon)).update.state).toBe("idle");
  });
});
