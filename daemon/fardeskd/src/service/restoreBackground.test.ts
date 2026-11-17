import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import { makeTempDir, waitUntil } from "../../test/support/env.js";
import { createLogger } from "../core/log.js";

describe("owned sessions come back in the background", () => {
  it("the daemon serves even when restoring its owned sessions fails, and logs why", async () => {
    const stateDir = makeTempDir("fds-");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "owned.json"), "{not json");
    const lines: string[] = [];
    const daemon = await startTestDaemon({ stateDir }, { log: createLogger((line) => { lines.push(line); }, () => new Date()) });
    try {
      expect((await daemon.call("GET", "/v1/machine")).status).toBe(200);
      await waitUntil(() => lines.some((line) => line.includes("owned_restore_failed")));
    } finally {
      await daemon.close();
    }
  });
});
