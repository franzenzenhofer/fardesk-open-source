// POST /v1/hub/update-all: the hub brings every machine it knows to the newest version in the fleet (hub only).
import type { Config } from "../config/config.js";
import { machinesOf } from "../coordinator/local.js";
import type { LocalServices } from "../coordinator/local.js";
import type { App } from "../server/context.js";
import { updateAll } from "../update/updateAll.js";

export function registerUpdateAllRoute(app: App, services: LocalServices, config: Config): void {
  app.post("/v1/hub/update-all", async (c) => c.json(await updateAll(machinesOf(config, services), config.name)));
}
