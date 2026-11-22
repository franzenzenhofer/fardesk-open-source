import { describe, expect, it } from "vitest";
import { colourDistance, contrast, deltaE2000, hexToRgb, rgbToLab } from "./colourMath.js";

describe("colour maths", () => {
  // Rows of the authors' reference data (Sharma, Wu, Dalal 2005, table 1): https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/
  it.each([
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
  ] as const)("CIEDE2000 of %j and %j is %f", (p, q, expected) => {
    expect(deltaE2000(p, q)).toBeCloseTo(expected, 3);
    expect(deltaE2000(q, p)).toBeCloseTo(expected, 3);
  });

  it("converts sRGB to Lab like the CSS reference", () => {
    const [l, a, b] = rgbToLab([255, 255, 255]);
    expect(Math.round(l)).toBe(100);
    expect(Math.abs(a)).toBeLessThan(0.01);
    expect(Math.abs(b)).toBeLessThan(0.01);
    const [lr, ar] = rgbToLab([255, 0, 0]);
    expect([Math.round(lr), Math.round(ar)]).toEqual([53, 80]);
  });

  it("computes the WCAG contrast ratio: 21 for black on white, 1 for the same colour", () => {
    expect(contrast([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 5);
    expect(contrast([120, 130, 140], [120, 130, 140])).toBe(1);
    expect(contrast([119, 119, 119], [255, 255, 255])).toBeCloseTo(4.48, 2);
  });

  it("reads #RRGGBB only, upper case", () => {
    expect(hexToRgb("#1AA1FB")).toEqual([26, 161, 251]);
    for (const bad of ["#1aa1fb", "1AA1FB", "#FFF", "red"]) expect(() => hexToRgb(bad)).toThrow(/#RRGGBB/);
    expect(colourDistance("#1AA1FB", "#1AA1FB")).toBe(0);
  });
});
