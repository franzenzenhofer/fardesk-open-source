import { describe, expect, it } from "vitest";
import { COLOR_PATTERN, LABEL_PRESETS, PALETTE_SIZE } from "../contract/palette.js";
import { colourDistance, contrast, hexToRgb } from "./colourMath.js";

/**
 * Threshold, fixed: 7 in CIEDE2000. One unit of 2.3 is the just-noticeable difference of two flat patches side by
 * side (Sharma et al. 2005, section 3); the dots in the list are small and seen one after the other, so the floor
 * is three times that. The 64 presets are packed as far apart as the visible range allows: the farthest-point
 * selection reached 7.75 at 64 colours, so 7 is the highest round threshold they keep.
 */
const MIN_PRESET_DISTANCE = 7;
/** The dot must show on the white and on the black background: WCAG 2.1 asks 3:1 for graphics, 2:1 is the floor we accept for a small dot next to text. */
const MIN_CONTRAST = 2;
/** State colours (system red, orange, green, grey in light and dark): a preset must never be mistaken for a state. */
const STATE_COLOURS = ["#FF3B30", "#FF453A", "#FF9500", "#FF9F0A", "#34C759", "#30D158", "#8A8A8E", "#8D8D93"];
const MIN_STATE_DISTANCE = 15;

const colours = LABEL_PRESETS.map((preset) => preset.color);

describe("label presets", () => {
  it("are 64, upper-case #RRGGBB, each colour and each name once", () => {
    expect(LABEL_PRESETS).toHaveLength(PALETTE_SIZE);
    expect(colours.every((colour) => COLOR_PATTERN.test(colour))).toBe(true);
    expect(new Set(colours).size).toBe(PALETTE_SIZE);
    expect(new Set(LABEL_PRESETS.map((preset) => preset.name)).size).toBe(PALETTE_SIZE);
  });

  it("names never use a state colour word", () => {
    expect(LABEL_PRESETS.filter((preset) => /\b(red|orange|green|gr[ae]y)\b/i.test(preset.name))).toEqual([]);
  });

  it(`keep a CIEDE2000 distance of at least ${MIN_PRESET_DISTANCE} between every two`, () => {
    const closest = colours.flatMap((one, index) => colours.slice(index + 1).map((two) => ({ one, two, distance: colourDistance(one, two) })));
    expect(closest.filter((pair) => pair.distance < MIN_PRESET_DISTANCE)).toEqual([]);
  });

  it(`stay visible: contrast of at least ${MIN_CONTRAST}:1 on white and on black (WCAG 2.1 contrast ratio)`, () => {
    for (const colour of colours) {
      expect(contrast(hexToRgb(colour), [255, 255, 255]), `${colour} on white`).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(hexToRgb(colour), [0, 0, 0]), `${colour} on black`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it(`stay at least ${MIN_STATE_DISTANCE} away from the red, orange, green and grey that mean state`, () => {
    const near = colours.flatMap((colour) => STATE_COLOURS.filter((state) => colourDistance(colour, state) < MIN_STATE_DISTANCE).map((state) => `${colour} ~ ${state}`));
    expect(near).toEqual([]);
  });
});
