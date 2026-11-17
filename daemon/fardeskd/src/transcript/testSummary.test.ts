import { describe, expect, it } from "vitest";
import { parseTestSummary, testSummarySuffix } from "./testSummary.js";

const VITEST_OK = [" RUN  v5.1.0", " Test Files  3 passed (3)", "      Tests  31 passed (31)", "   Duration  1.2s"].join("\n");
const VITEST_FAIL = "      Tests  2 failed | 29 passed (31)\n";
const JEST = "Tests:       1 failed, 31 passed, 32 total\nTime: 2s";
const XCTEST = [
  "Test Suite 'PaintTests' passed.",
  "\t Executed 12 tests, with 0 failures (0 unexpected) in 0.5 (0.5) seconds",
  "Test Suite 'All tests' passed.",
  "\t Executed 31 tests, with 0 failures (0 unexpected) in 1.0 (1.0) seconds",
].join("\n");
const XCTEST_FAIL = "\t Executed 31 tests, with 3 failures (3 unexpected) in 1.0 (1.0) seconds";
const SWIFT_TESTING = "✔ Test run with 31 tests in 4 suites passed after 0.002 seconds.";
const SWIFT_TESTING_ONE = "Test run with 1 test in 1 suite passed after 0.1 seconds.";
const SWIFT_TESTING_FAIL = "✘ Test run with 31 tests in 4 suites failed after 0.1 seconds with 2 issues.";
const SWIFT_TESTING_FAIL_NO_ISSUES = "Test run with 5 tests failed";
const PYTEST = "=========== 3 passed in 0.12s ===========";
const PYTEST_MIXED = "=========== 1 failed, 3 passed in 0.12s ===========";
const CARGO = ["test result: ok. 12 passed; 0 failed; 0 ignored", "test result: ok. 7 passed; 0 failed; 1 ignored"].join("\n");
const CARGO_FAIL = "test result: FAILED. 7 passed; 2 failed; 0 ignored";

describe("parseTestSummary", () => {
  it.each([
    ["vitest", VITEST_OK, { passed: 31, failed: 0 }],
    ["vitest failing", VITEST_FAIL, { passed: 29, failed: 2 }],
    ["jest", JEST, { passed: 31, failed: 1 }],
    ["xctest takes the last (total) line", XCTEST, { passed: 31, failed: 0 }],
    ["xctest failing", XCTEST_FAIL, { passed: 28, failed: 3 }],
    ["swift testing", SWIFT_TESTING, { passed: 31, failed: 0 }],
    ["swift testing singular", SWIFT_TESTING_ONE, { passed: 1, failed: 0 }],
    ["swift testing failing counts issues", SWIFT_TESTING_FAIL, { passed: 0, failed: 2 }],
    ["swift testing failing without issues", SWIFT_TESTING_FAIL_NO_ISSUES, { passed: 0, failed: 5 }],
    ["pytest", PYTEST, { passed: 3, failed: 0 }],
    ["pytest mixed", PYTEST_MIXED, { passed: 3, failed: 1 }],
    ["cargo takes the last result line", CARGO, { passed: 7, failed: 0 }],
    ["cargo failing", CARGO_FAIL, { passed: 7, failed: 2 }],
  ])("%s", (_name, output, expected) => {
    expect(parseTestSummary(output)).toEqual(expected);
  });

  it.each([
    ["", "empty output"],
    ["compiled 12 files\nBuild complete!", "no runner line"],
    ["Executed 0 tests, with 0 failures (0 unexpected)", "a runner that ran nothing"],
  ])("returns null for %j (%s)", (output) => {
    expect(parseTestSummary(output)).toBeNull();
  });

  it.each([
    ["rsync failure line", "sending incremental file list\nrsync: 40 files failed to transfer\n"],
    ["dry gate listing", "found 0 clones, 40 failed checks listed\n12 passed rules\n"],
    ["retry log line", "2026-11-15 retry 3 failed, 5 passed through\n"],
    ["a sentence that mentions tests", "the Tests 40 failed earlier were flaky, now 3 passed\n"],
    ["pytest-like line inside prose", "note: 3 passed, 40 failed over the weekend\n"],
    ["a Tests line with trailing prose", "      Tests  40 failed because of the network\n"],
    ["cd into a directory then a count", "cd /private/tmp/x\nbuild: 40 failed\n"],
  ])("ignores a loose count: %s", (_name, output) => {
    expect(parseTestSummary(output)).toBeNull();
    expect(testSummarySuffix(output)).toBe("");
  });

  it("reads a quiet pytest summary and ignores warnings counts", () => {
    expect(parseTestSummary("1 failed, 3 passed, 2 warnings in 0.50s")).toEqual({ passed: 3, failed: 1 });
  });

  it("falls through to the next runner when the first only saw zero tests", () => {
    const output = "Executed 0 tests, with 0 failures (0 unexpected)\nTest run with 4 tests in 1 suite passed after 0.1 seconds.";
    expect(parseTestSummary(output)).toEqual({ passed: 4, failed: 0 });
  });
});

describe("testSummarySuffix", () => {
  it.each([
    [VITEST_OK, " - 31 passed"],
    [VITEST_FAIL, " - 2 failed"],
    ["nothing to see", ""],
  ])("%j", (output, expected) => {
    expect(testSummarySuffix(output)).toBe(expected);
  });
});
