// The update calls of a peer daemon: its facts, its release package (down) and a new release package (up).
import { machineSchema, machineUpdateResultSchema } from "../contract/schema.js";
import type { Peer } from "../contract/schema.js";
import { fetchPeer, request } from "./remote.js";
import type { MachineEndpoint } from "./types.js";

const PACKAGE_SHA_HEADER = "x-fardesk-package-sha256";

type PackageInit = { method: "GET" | "POST"; headers?: Record<string, string>; body?: Buffer };

async function packageCall(peer: Peer, token: string, path: string, init: PackageInit): Promise<Response> {
  return fetchPeer(peer, path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } });
}

export function updateCalls(peer: Peer, token: string): Pick<MachineEndpoint, "machine" | "updatePackage" | "startUpdate"> {
  return {
    // A newer peer may add fields to its machine facts: unknown keys are dropped, never refused.
    machine: async () => request(peer, token, { method: "GET", path: "/v1/machine" }, machineSchema.strip()),
    updatePackage: async () => new Uint8Array(await (await packageCall(peer, token, "/v1/update/package", { method: "GET" })).arrayBuffer()),
    async startUpdate(bytes, sha256): Promise<void> {
      const headers = { "content-type": "application/gzip", [PACKAGE_SHA_HEADER]: sha256 };
      const response = await packageCall(peer, token, "/v1/machine/update", { method: "POST", headers, body: Buffer.from(bytes) });
      machineUpdateResultSchema.parse(await response.json());
    },
  };
}
