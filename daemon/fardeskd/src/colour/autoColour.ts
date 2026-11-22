// Automatic colour coding: which preset a new session gets. Pure and deterministic.
// The new session takes the preset that is farthest (CIEDE2000) from every colour in use on this machine, so
// the colours a person sees side by side are as different as the palette allows, and a colour that is taken
// (distance 0) is never chosen while a free one exists. With all 64 in use the least used one is taken again.
import { LABEL_PRESETS } from "../contract/palette.js";
import { colourDistance } from "./colourMath.js";

/** The first session of a machine gets Azure: a calm blue that reads on white and on black. */
const FIRST_COLOUR = "#1AA1FB";

const PRESET_COLOURS = LABEL_PRESETS.map((preset) => preset.color);

function leastUsed(taken: readonly string[]): string {
  const uses = (colour: string): number => taken.filter((other) => other === colour).length;
  return PRESET_COLOURS.reduce((best, colour) => (uses(colour) < uses(best) ? colour : best));
}

function nearestInUse(colour: string, taken: readonly string[]): number {
  return Math.min(...taken.map((other) => colourDistance(colour, other)));
}

/** `taken`: the colours shown for the other sessions of the machine (a user's pick or an automatic colour). */
export function pickAutoColour(taken: readonly string[]): string {
  if (taken.length === 0) return FIRST_COLOUR;
  const free = PRESET_COLOURS.filter((colour) => !taken.includes(colour));
  if (free.length === 0) return leastUsed(taken);
  const scored = free.map((colour) => ({ colour, distance: nearestInUse(colour, taken) }));
  return scored.reduce((best, next) => (next.distance > best.distance ? next : best)).colour;
}
