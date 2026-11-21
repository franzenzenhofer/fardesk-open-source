import { describe, expect, it } from "vitest";
import * as transcript from "./index.js";

describe("transcript public surface", () => {
  it("exports the documented functions", () => {
    expect(Object.keys(transcript).sort()).toEqual(
      ["buildDetail", "createParseStats", "createTailer", "finishedToolCalls", "mapActivities", "pageActivities", "parseLine", "summarise"].sort(),
    );
  });
});
