// Recognises the final summary line of the common test runners in a Bash output.

export type TestCounts = { passed: number; failed: number };

type Runner = { pattern: RegExp; counts(match: RegExpExecArray): TestCounts };

function numberBefore(text: string, word: string): number {
  const match = new RegExp(`(\\d+) ${word}`).exec(text);
  return Number(match?.[1] ?? 0);
}

function lineCounts(match: RegExpExecArray): TestCounts {
  const line = match[0];
  return { passed: numberBefore(line, "passed"), failed: numberBefore(line, "failed") };
}

const VITEST_WORDS = "failed|passed|skipped|todo";
const JEST_WORDS = "failed|passed|skipped|todo|total";
const PYTEST_WORDS = "failed|passed|skipped|errors?|xfailed|xpassed|warnings?|deselected";

// "N word" repeated with a separator, nothing else: a whole summary line has no room for loose prose.
function counted(words: string, separator: string): string {
  const one = `\\d+ (?:${words})`;
  return `${one}(?:${separator}${one})*`;
}

// Every pattern is anchored to the exact summary line its runner prints.
const RUNNERS: readonly Runner[] = [
  {
    // Swift Testing: "Test run with 31 tests in 4 suites passed after 0.2 seconds."
    pattern: /Test run with (\d+) tests?(?: in \d+ suites?)? (passed|failed)(?: after [\d.]+ seconds(?: with (\d+) issues?)?)?/g,
    counts: (match) =>
      match[2] === "passed"
        ? { passed: Number(match[1]), failed: 0 }
        : { passed: 0, failed: Number(match[3] ?? match[1]) },
  },
  {
    // XCTest: "Executed 31 tests, with 0 failures (0 unexpected)"
    pattern: /Executed (\d+) tests?, with (\d+) failures?/g,
    counts: (match) => ({ passed: Number(match[1]) - Number(match[2]), failed: Number(match[2]) }),
  },
  {
    // cargo: "test result: ok. 12 passed; 0 failed; 0 ignored"
    pattern: /test result: (?:ok|FAILED)\. \d+ passed; \d+ failed/g,
    counts: lineCounts,
  },
  {
    // vitest: "Tests  1 failed | 31 passed (32)"
    pattern: new RegExp(`^\\s*Tests\\s{2,}${counted(VITEST_WORDS, " \\| ")}(?: \\(\\d+\\))?\\s*$`, "gm"),
    counts: lineCounts,
  },
  {
    // jest: "Tests:       1 failed, 31 passed, 32 total"
    pattern: new RegExp(`^\\s*Tests:\\s+${counted(JEST_WORDS, ", ")}\\s*$`, "gm"),
    counts: lineCounts,
  },
  {
    // pytest: "=== 1 failed, 3 passed in 0.12s ===" (the "===" frame is absent with -q)
    pattern: new RegExp(`^(?:=+ )?${counted(PYTEST_WORDS, ", ")} in [\\d.]+s(?: \\(\\d+:\\d+:\\d+\\))?(?: =+)?\\s*$`, "gm"),
    counts: lineCounts,
  },
];

export function parseTestSummary(output: string): TestCounts | null {
  for (const runner of RUNNERS) {
    const found = [...output.matchAll(runner.pattern)]
      .map((match) => runner.counts(match))
      .filter((counts) => counts.passed + counts.failed > 0);
    const last = found.at(-1);
    if (last !== undefined) return last;
  }
  return null;
}

export function testSummarySuffix(output: string): string {
  const counts = parseTestSummary(output);
  if (counts === null) return "";
  return counts.failed > 0 ? ` - ${counts.failed} failed` : ` - ${counts.passed} passed`;
}
