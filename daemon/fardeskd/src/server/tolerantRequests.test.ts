// Every request body is read tolerantly (public/docs/VERSIONING.md, section 3): a field a newer app adds is dropped, never refused.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";

let daemon: TestDaemon;
let sessionId: string;

beforeEach(async () => {
  daemon = await startTestDaemon();
  sessionId = daemon.home.addTranscript({ fixture: "01-simple-session" }).sessionId;
  daemon.home.addRegistry({ fixture: "idle", sessionId });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
});

afterEach(async () => {
  await daemon.close();
});

const EXTRA = { fieldFromANewerApp: { nested: [1, 2] } };
const report = { id: "6f1c2b0e-8c6d-4f0a-9d3e-2b7a1c5d4e90", at: "2026-11-22T10:00:00.000Z", message: "boom", area: "list", appVersion: "4.3.0", build: "1", platform: "ios" };

describe("request bodies with an unknown extra field", () => {
  it("are accepted by the routes that change something we can check", async () => {
    const path = (suffix: string): string => `/v1/sessions/${sessionId}/${suffix}`;
    expect((await daemon.call("POST", path("mute"), { muted: true, ...EXTRA })).status).toBe(200);
    expect((await daemon.call("POST", path("label"), { name: "Named", ...EXTRA })).status).toBe(200);
    expect(daemon.services.sessions().find((session) => session.id === sessionId)?.label.name).toBe("Named");
    expect((await daemon.call("POST", "/v1/notifications/pause", { minutes: 0, ...EXTRA })).status).toBe(200);
    expect((await daemon.call("POST", "/v1/telemetry", { reports: [{ ...report, ...EXTRA }], ...EXTRA })).status).toBe(200);
    const device = { apnsToken: "ab".repeat(32), environment: "sandbox", name: "Phone", notifications: ["done"], ...EXTRA };
    expect((await daemon.call("POST", "/v1/devices", device)).status).toBe(200);
  });

  it("get past validation on the routes that need more state (never a 400 for the extra field)", async () => {
    const path = (suffix: string): string => `/v1/sessions/${sessionId}/${suffix}`;
    const bodies: [string, unknown][] = [
      [path("kill"), { closeTab: false, ...EXTRA }],
      [path("message"), { text: "hello", ...EXTRA }],
      [path("permission/req_1"), { decision: "allow", ...EXTRA }],
      [path("answer/q_1"), { option: "yes", ...EXTRA }],
      ["/v1/coordinator", { prompt: "hi", ...EXTRA }],
      ["/v1/auth/revoke", { device: "nobody", ...EXTRA }],
    ];
    for (const [route, body] of bodies) {
      const response = await daemon.call("POST", route, body);
      expect(response.status, route).not.toBe(400);
    }
  });
});
