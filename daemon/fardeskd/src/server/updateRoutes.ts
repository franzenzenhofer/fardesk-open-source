// The lifeline of public/docs/VERSIONING.md: fetch this machine's release package and give it a new one. These never change their shape.
import type { MachineUpdateResult } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import type { Services } from "../service/types.js";
import { MAX_UPDATE_PACKAGE_BYTES } from "../update/updater.js";
import { readBoundedBody } from "./boundedBody.js";
import type { App } from "./context.js";

export const PACKAGE_SHA_HEADER = "x-fardesk-package-sha256";
const SHA256_PATTERN = /^[0-9a-fA-F]{64}$/;

export function registerUpdateRoutes(app: App, services: Services): void {
  app.get("/v1/update/package", (c) => c.body(services.updatePackage(), 200, { "content-type": "application/gzip" }));
  app.post("/v1/machine/update", async (c) => {
    const sha256 = c.req.header(PACKAGE_SHA_HEADER) ?? "";
    if (!SHA256_PATTERN.test(sha256)) throw new FardeskError("invalid_request", "the X-Fardesk-Package-Sha256 header must hold the SHA-256 of the package (64 hex characters)");
    await services.startUpdate(await readBoundedBody(c.req.raw, MAX_UPDATE_PACKAGE_BYTES), sha256);
    return c.json({ ok: true, state: "running" } satisfies MachineUpdateResult);
  });
}
