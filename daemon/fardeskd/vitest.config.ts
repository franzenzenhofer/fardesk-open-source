import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { defineConfig } from "vitest/config";

// Pragmatic floor: cannot regress far, but the last lines of glue are not chased.
const COVERAGE_FLOOR = 90;

export default defineConfig({
  test: {
    // Every delivery (inbox socket, tmux, osascript) must stay inside the temp dir: see src/core/sandbox.ts.
    // Test homes and folders live in the temp dir, which production treats as automation: point the automation
    // roots at a folder no test uses, so the suites see their sessions. src/sessions/automation.test.ts sets its own.
    env: { FARDESK_TEST_SANDBOX: realpathSync(tmpdir()), FARDESK_AUTOMATION_ROOTS: "/fardesk-test-no-automation-root" },
    include: ["src/**/*.test.ts"],
    // Many suites start real claude, tmux and daemons: with one worker per core they starve each other
    // and time out (3 timeouts on 2026-11-16 at 10 workers; every one passed alone).
    maxWorkers: 4,
    // A different real-process test timed out in each full run (sendEscape, /clear, version probe) and
    // each passed alone in about 1 s: process starts slow down under load. One retry; a real bug fails twice.
    // 2026-11-17: the real-claude compact/queued tests timed out in 4 of 7 full runs (private and export alike), twice in a row
    // on the same test, each passing alone in seconds: so two retries. A real bug still fails three times.
    retry: 2,
    // First runs of freshly written test executables are sometimes held by macOS for over 20 s (two timeouts on
    // 2026-11-16 at load 3.4, both passing alone), so real-process tests get 60 s.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      reporter: ["text-summary", "json-summary", "lcov"],
      thresholds: {
        lines: COVERAGE_FLOOR,
        branches: COVERAGE_FLOOR,
        functions: COVERAGE_FLOOR,
        statements: COVERAGE_FLOOR,
      },
    },
  },
});
