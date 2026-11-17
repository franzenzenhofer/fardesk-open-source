import type { FixtureCases } from "./fixtureTypes.js";

const REPORT_ID_A = "3b0c8e2a-5f4d-4c1e-9a7b-1d2e3f405162";
const REPORT_ID_B = "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

const feedReport = {
  id: REPORT_ID_A,
  at: "2026-11-15T09:30:12.000Z",
  message: "The request timed out",
  kind: "error",
  code: "URLError -1001",
  area: "feed",
  machine: "Studio Mac",
  sessionId: "sess_7f3a91",
  appVersion: "1.2.0",
  build: "8",
  platform: "iOS 26.1",
} as const;

const eventReport = {
  id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  at: "2026-11-15T09:32:05.000Z",
  message: "session opened",
  kind: "event",
  durationMs: 420,
  area: "feed",
  machine: "Studio Mac",
  sessionId: "sess_7f3a91",
  appVersion: "1.2.0",
  build: "8",
  platform: "iOS 26.1",
} as const;

const minimalReport = {
  id: REPORT_ID_B,
  at: "2026-11-15T09:31:40.000Z",
  message: "Could not start the reply",
  area: "reply",
  appVersion: "1.2.0",
  build: "8",
  platform: "macOS 26.1",
} as const;

export const ghosttyProbeResultFixtures: FixtureCases<"GhosttyProbeResult"> = {
  ok: { ghosttyAutomation: "ok" },
  denied: { ghosttyAutomation: "denied" },
  unknown: { ghosttyAutomation: "unknown" },
};

export const killRequestFixtures: FixtureCases<"KillRequest"> = {
  closeTab: { closeTab: true },
  keepTab: { closeTab: false },
};

export const killResultFixtures: FixtureCases<"KillResult"> = {
  pane: { ok: true, closed: "pane" },
  tab: { ok: true, closed: "tab" },
  none: { ok: true, closed: "none" },
};

export const attachmentResultFixtures: FixtureCases<"AttachmentResult"> = {
  screenshot: {
    attachmentId: "1f6e0b7a-2c3d-4e5f-8a9b-0c1d2e3f4a5b",
    path: "/Users/dev/smear-studio/.fardesk/attachments/20261115T093012345Z-screenshot.png",
    mediaType: "image/png",
    bytes: 182044,
  },
};

export const telemetryReportFixtures: FixtureCases<"TelemetryReport"> = { full: feedReport, minimal: minimalReport, event: eventReport };
export const telemetryBatchFixtures: FixtureCases<"TelemetryBatch"> = { three: { reports: [feedReport, minimalReport, eventReport] } };
export const telemetryResultFixtures: FixtureCases<"TelemetryResult"> = { stored: { accepted: 2, duplicates: 0 }, repeated: { accepted: 0, duplicates: 2 } };
export const telemetryListFixtures: FixtureCases<"TelemetryList"> = { three: { reports: [eventReport, minimalReport, feedReport] }, none: { reports: [] } };
