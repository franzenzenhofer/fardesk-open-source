// The 64 preset colours a session can be marked with. Defined here once: the generated fixture
// `schema/fixtures/LabelPalette/presets.json` carries them to the app (a Swift test compares), and the daemon
// draws its automatic colours from them. Rules, all checked by palette.test.ts:
//  - never red, orange, green or grey: those mean state (docs/design/COLOUR-CODING.md);
//  - visible as a dot on white and on black (contrast of at least 2:1, WCAG 2.1);
//  - every pair at least 7 apart in CIEDE2000.
// Picked by farthest-point selection over a grid of in-gamut Lab colours (lightness 30-74, chroma 30-90, hue
// 165-360 and 0-16 degrees), then named by hand for VoiceOver. The order is hue order, which is also the grid order.

export type PalettePreset = { readonly name: string; readonly color: string };

export const LABEL_PRESETS: readonly PalettePreset[] = [
  { name: "Burgundy", color: "#8E0443" },
  { name: "Dusty Rose", color: "#AD6879" },
  { name: "Blush", color: "#E197A5" },
  { name: "Wine", color: "#7D3C47" },
  { name: "Raspberry", color: "#B83958" },
  { name: "Rosewood", color: "#98545F" },
  { name: "Cerise", color: "#FD0568" },
  { name: "Flamingo", color: "#FD6988" },
  { name: "Spruce", color: "#045B45" },
  { name: "Jade", color: "#0B9371" },
  { name: "Seafoam", color: "#5AA48A" },
  { name: "Fir", color: "#237A69" },
  { name: "Turquoise", color: "#39BFA4" },
  { name: "Teal", color: "#389489" },
  { name: "Peacock", color: "#078488" },
  { name: "Lagoon", color: "#44AAAC" },
  { name: "Capri", color: "#35B9DB" },
  { name: "Lake", color: "#2D91AF" },
  { name: "Petrol", color: "#057698" },
  { name: "Sky", color: "#70B2DE" },
  { name: "Deep Sea", color: "#105A84" },
  { name: "Steel Blue", color: "#487BA9" },
  { name: "Azure", color: "#1AA1FB" },
  { name: "Periwinkle", color: "#95ABE0" },
  { name: "Cornflower", color: "#628EED" },
  { name: "Navy", color: "#31447C" },
  { name: "Cobalt", color: "#0449B3" },
  { name: "Slate Blue", color: "#5963A9" },
  { name: "Royal Blue", color: "#135FE2" },
  { name: "Bluebell", color: "#5774E6" },
  { name: "Dusk", color: "#7A7DB1" },
  { name: "Iris", color: "#867AFA" },
  { name: "Wisteria", color: "#A899FA" },
  { name: "Indigo", color: "#3B2EB6" },
  { name: "Twilight", color: "#4C3F6D" },
  { name: "Ultraviolet", color: "#654DE7" },
  { name: "Amethyst", color: "#8068C4" },
  { name: "Lilac", color: "#B4A3D8" },
  { name: "Grape", color: "#684A97" },
  { name: "Heather", color: "#826898" },
  { name: "Lavender", color: "#A479CA" },
  { name: "Violet", color: "#BA75FE" },
  { name: "Plum", color: "#60327B" },
  { name: "Purple", color: "#8F36C5" },
  { name: "Bright Purple", color: "#B452EF" },
  { name: "Orchid", color: "#D490F7" },
  { name: "Eggplant", color: "#760996" },
  { name: "Wild Orchid", color: "#9F5DB3" },
  { name: "Damson", color: "#643E67" },
  { name: "Boysenberry", color: "#954393" },
  { name: "Cyclamen", color: "#C75DC4" },
  { name: "Thistle", color: "#B687B2" },
  { name: "Fuchsia", color: "#F459F2" },
  { name: "Mulberry", color: "#7E1B6A" },
  { name: "Magenta", color: "#DA04B7" },
  { name: "Mauve", color: "#AE629A" },
  { name: "Bubblegum", color: "#E590C6" },
  { name: "Antique Mauve", color: "#8A5171" },
  { name: "Merlot", color: "#742E53" },
  { name: "Hot Pink", color: "#F726A7" },
  { name: "Candy Pink", color: "#F965B5" },
  { name: "Ruby", color: "#AE006A" },
  { name: "Rose Pink", color: "#C8789A" },
  { name: "Peony", color: "#D53781" },
];

export const PALETTE_SIZE = 64;
/** Pattern of every label colour on the wire: `#RRGGBB`, upper case. */
export const COLOR_PATTERN = /^#[0-9A-F]{6}$/;
