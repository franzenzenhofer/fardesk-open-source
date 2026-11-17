import type { FixtureCases } from "./fixtureTypes.js";

export const activityDetailFixtures: FixtureCases<"ActivityDetail"> = {
  diff: {
    activityId: "act_0006",
    kind: "diff",
    truncated: false,
    sections: [
      {
        title: "Sources/PaintEngine.swift",
        subtitle: "Edited",
        added: 2,
        removed: 1,
        lines: [
          { number: 41, sign: " ", text: "func blend(_ a: Color, _ b: Color) -> Color {" },
          { number: 42, sign: "-", text: "    return a.mix(b, 0.5)" },
          { number: 42, sign: "+", text: "    let falloff = smoothstep(0, 1, strength)" },
          { number: 43, sign: "+", text: "    return a.mix(b, falloff)" },
          { number: null, sign: " ", text: "" },
        ],
      },
    ],
  },
  diffTruncated: {
    activityId: "act_0015",
    kind: "diff",
    truncated: true,
    sections: [
      {
        title: "Tests/PaintEngineTests.swift",
        subtitle: "",
        added: 120,
        removed: 0,
        lines: [{ number: 1, sign: "+", text: "import Testing" }],
      },
    ],
  },
  output: {
    activityId: "act_0004",
    kind: "output",
    truncated: false,
    sections: [
      {
        title: "swift test",
        subtitle: "exit 0",
        added: 0,
        removed: 0,
        lines: [
          { number: null, sign: " ", text: "Test Suite 'All tests' started" },
          { number: null, sign: " ", text: "Executed 31 tests, with 0 failures" },
        ],
      },
    ],
  },
  outputNoSections: { activityId: "act_0003", kind: "output", truncated: false, sections: [] },
};
