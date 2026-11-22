import { describe, expect, it } from "vitest";
import { LABEL_PRESETS, PALETTE_SIZE } from "../contract/palette.js";
import { pickAutoColour } from "./autoColour.js";
import { colourDistance } from "./colourMath.js";

function assignInOrder(count: number): string[] {
  const taken: string[] = [];
  for (let index = 0; index < count; index++) taken.push(pickAutoColour(taken));
  return taken;
}

describe("pickAutoColour", () => {
  it("starts with Azure and is a pure function of the colours in use", () => {
    expect(pickAutoColour([])).toBe("#1AA1FB");
    expect(pickAutoColour(["#1AA1FB"])).toBe(pickAutoColour(["#1AA1FB"]));
  });

  it("hands out 64 different presets to 64 sessions", () => {
    const colours = assignInOrder(PALETTE_SIZE);
    expect(new Set(colours).size).toBe(PALETTE_SIZE);
    expect(colours.every((colour) => LABEL_PRESETS.some((preset) => preset.color === colour))).toBe(true);
    expect(assignInOrder(PALETTE_SIZE)).toEqual(colours);
  });

  it("makes the first few sessions clearly different: at least 20 apart for the first 8", () => {
    const colours = assignInOrder(8);
    const gaps = colours.flatMap((one, index) => colours.slice(index + 1).map((two) => colourDistance(one, two)));
    expect(Math.min(...gaps)).toBeGreaterThan(20);
  });

  it("skips a colour a user picked and one too close to it", () => {
    const picked = "#1AA1FB";
    const next = pickAutoColour([picked]);
    expect(next).not.toBe(picked);
    expect(colourDistance(next, picked)).toBeGreaterThan(30);
  });

  it("takes the least used preset again when all 64 are in use", () => {
    const all = LABEL_PRESETS.map((preset) => preset.color);
    expect(pickAutoColour([...all, ...all.slice(1)])).toBe(all[0]);
  });
});
