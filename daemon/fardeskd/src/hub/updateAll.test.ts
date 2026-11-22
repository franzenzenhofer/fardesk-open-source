// Update all, against real daemons on 127.0.0.1: a hub, one live peer, a closed port and a peer without a token.
import { afterEach, describe, expect, it } from "vitest";
import { pairAs } from "../../test/support/auth.js";
import { runTool } from "../../test/support/coordinator.js";
import { hubConfig } from "../../test/support/hubRig.js";
import { TEST_TOKEN, startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntilAsync } from "../../test/support/env.js";
import { installDirWith, makeRelease, scriptInstaller } from "../../test/support/release.js";
import type { Release, ScriptInstaller } from "../../test/support/release.js";
import { createCoordinatorBackend } from "../coordinator/backend.js";
import { errorResponseSchema, machineSchema, updateAllResultSchema } from "../contract/schema.js";

type Side = { version: string; release: Release | null };
type Rig = { hub: TestDaemon; peer: TestDaemon; hubScript: ScriptInstaller; peerScript: ScriptInstaller };

const open: TestDaemon[] = [];

afterEach(async () => {
  for (const daemon of open.splice(0)) await daemon.close();
});

async function startRig(hubSide: Side, peerSide: Side): Promise<Rig> {
  const hubScript = scriptInstaller(0, "installing");
  const peerScript = scriptInstaller(0, "installing");
  const update = (side: Side, script: ScriptInstaller): { version: string; update: { installDir: string; installer: ScriptInstaller["installer"] } } => ({
    version: side.version,
    update: { installDir: installDirWith(side.release), installer: script.installer },
  });
  const peer = await startTestDaemon({ name: "Peer A" }, update(peerSide, peerScript));
  const hub = await startTestDaemon(await hubConfig(peer.url), update(hubSide, hubScript));
  open.push(hub, peer);
  return { hub, peer, hubScript, peerScript };
}

const updateAllOn = async (hub: TestDaemon, token = TEST_TOKEN): Promise<{ status: number; json: unknown }> => hub.call("POST", "/v1/hub/update-all", undefined, token);
const versionOf = async (daemon: TestDaemon): Promise<string> => machineSchema.parse((await daemon.call("GET", "/v1/machine")).json).version;

describe("POST /v1/hub/update-all", () => {
  it("takes the package of the newer peer and installs it on the older hub; unlinked and closed machines are reported, not hidden", async () => {
    const release = makeRelease("4.3.0");
    const { hub, hubScript } = await startRig({ version: "4.2.0", release: null }, { version: "4.3.0", release });
    const response = await updateAllOn(hub);
    expect(response.status).toBe(200);
    const result = updateAllResultSchema.parse(response.json);
    expect(result.source).toBe("Peer A");
    expect(result.version).toBe("4.3.0");
    expect(result.machines.map((entry) => [entry.name, entry.from, entry.result])).toEqual([
      ["hub-box", "4.2.0", "started"],
      ["Peer A", "4.3.0", "current"],
      ["dead", null, "failed"],
      ["unlinked", null, "failed"],
    ]);
    expect(result.machines[3]?.message).toContain("not linked");
    expect((await hubScript.ran()).packageVersion).toBe("4.3.0");
    expect(machineSchema.parse((await hub.call("GET", "/v1/machine")).json).update).toMatchObject({ state: "running", version: "4.3.0" });
  });

  it("installs the hub's own package on an older peer and leaves the hub alone", async () => {
    const release = makeRelease("4.3.0");
    const { hub, peer, peerScript } = await startRig({ version: "4.3.0", release }, { version: "4.1.0", release: null });
    const result = updateAllResultSchema.parse((await updateAllOn(hub)).json);
    expect(result).toMatchObject({ source: "hub-box", version: "4.3.0" });
    expect(result.machines.slice(0, 2)).toEqual([
      { name: "hub-box", from: "4.3.0", result: "current", message: "already on 4.3.0" },
      { name: "Peer A", from: "4.1.0", result: "started", message: "installing 4.3.0, restarts when done" },
    ]);
    expect((await peerScript.ran()).packageVersion).toBe("4.3.0");
    expect(machineSchema.parse((await peer.call("GET", "/v1/machine")).json).update.state).toBe("running");
    expect(machineSchema.parse((await hub.call("GET", "/v1/machine")).json).update.state).toBe("idle");
  });

  it("reports an update that the machine refuses (one is already running there)", async () => {
    const release = makeRelease("4.3.0");
    const { hub } = await startRig({ version: "4.3.0", release }, { version: "4.1.0", release: null });
    await updateAllOn(hub);
    const again = updateAllResultSchema.parse((await updateAllOn(hub)).json);
    expect(again.machines[1]).toMatchObject({ name: "Peer A", result: "failed" });
    expect(again.machines[1]?.message).toContain("already running");
  });

  it("does nothing when every machine has the newest version, and a paired device may ask", async () => {
    const { hub, peer } = await startRig({ version: "4.2.0", release: null }, { version: "4.2.0", release: null });
    const device = await pairAs(hub, "Phone");
    const result = updateAllResultSchema.parse((await updateAllOn(hub, device.token)).json);
    expect(result.machines.slice(0, 2).map((entry) => entry.result)).toEqual(["current", "current"]);
    expect(await versionOf(peer)).toBe("4.2.0");
  });

  it("answers 401 without a token and 404 on a machine that is no hub", async () => {
    const { hub, peer } = await startRig({ version: "4.2.0", release: null }, { version: "4.2.0", release: null });
    expect((await hub.call("POST", "/v1/hub/update-all", undefined, null)).status).toBe(401);
    const plain = await peer.call("POST", "/v1/hub/update-all");
    expect(plain.status).toBe(404);
    expect(errorResponseSchema.parse(plain.json).error.code).toBe("not_found");
  });

  it("fails clearly when the newest machine has no package to give", async () => {
    const { hub } = await startRig({ version: "4.2.0", release: null }, { version: "4.3.0", release: null });
    const response = await updateAllOn(hub);
    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(response.json).error.message).toContain("no machine with the newest version can give its release package");
  });
});

describe("the package through the hub", () => {
  it("is fetched from a peer with GET and handed to it with POST via /m/<machine>/...", async () => {
    const release = makeRelease("4.3.0");
    const { hub, peerScript } = await startRig({ version: "4.2.0", release: null }, { version: "4.3.0", release });
    await waitUntilAsync(async () => (await hub.call("GET", "/m/Peer%20A/v1/machine")).status === 200);
    const fetched = await hub.fetch("/m/Peer%20A/v1/update/package", { headers: { authorization: `Bearer ${TEST_TOKEN}` } });
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-type")).toBe("application/gzip");
    expect(Buffer.from(await fetched.arrayBuffer()).equals(release.bytes)).toBe(true);
    const next = makeRelease("4.4.0");
    const posted = await hub.fetch("/m/Peer%20A/v1/machine/update", {
      method: "POST",
      headers: { authorization: `Bearer ${TEST_TOKEN}`, "content-type": "application/gzip", "x-fardesk-package-sha256": next.sha256 },
      body: next.bytes,
    });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toEqual({ ok: true, state: "running" });
    expect((await peerScript.ran()).packageVersion).toBe("4.4.0");
  });
});

describe("the coordinator tool update_machines", () => {
  it("reports every machine in plain words", async () => {
    const release = makeRelease("4.3.0");
    const { hub } = await startRig({ version: "4.2.0", release: null }, { version: "4.3.0", release });
    const backend = createCoordinatorBackend(hub.config, hub.services, () => null);
    const { text, isError } = await runTool(backend, "update_machines", {});
    expect(isError).toBe(false);
    expect(text).toContain("Newest version in the fleet: 4.3.0, package taken from Peer A.");
    expect(text).toContain("hub-box: update started (was 4.2.0) - installing 4.3.0, restarts when done");
    expect(text).toContain("Peer A: already current (was 4.3.0) - already on 4.3.0");
    expect(text).toContain("dead: NOT updated (version unknown)");
  });

  it("reports a failure of the whole run as a tool error", async () => {
    const { hub } = await startRig({ version: "4.2.0", release: null }, { version: "4.3.0", release: null });
    const backend = createCoordinatorBackend(hub.config, hub.services, () => null);
    expect(await runTool(backend, "update_machines", {})).toMatchObject({ isError: true, text: expect.stringContaining("not_found") as string });
  });
});
