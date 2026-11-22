// Colour maths for the label palette: sRGB to CIE Lab, CIEDE2000 distance, WCAG contrast.
// Checked for reuse: culori and color-diff do this, but a daemon that ships in an App Store product carries no
// extra runtime dependency for 80 lines of published formulas; colourMath.test.ts checks them against the
// reference values of the authors.

export type Rgb = readonly [number, number, number];
export type Lab = readonly [number, number, number];

const HEX_PATTERN = /^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/;
const RADIANS = Math.PI / 180;
const POW25_7 = 25 ** 7;

export function hexToRgb(hex: string): Rgb {
  const match = HEX_PATTERN.exec(hex);
  if (match === null) throw new Error(`not a #RRGGBB colour: ${hex}`);
  return [parseInt(match[1] ?? "", 16), parseInt(match[2] ?? "", 16), parseInt(match[3] ?? "", 16)];
}

function linear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance, https://www.w3.org/TR/WCAG21/#dfn-relative-luminance */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Contrast ratio, https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
export function contrast(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** CIE Lab, D65, https://www.w3.org/TR/css-color-4/#color-conversion-code */
export function rgbToLab(rgb: Rgb): Lab {
  const [r, g, b] = [linear(rgb[0]), linear(rgb[1]), linear(rgb[2])];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function hueDegrees(b: number, a: number): number {
  return b === 0 && a === 0 ? 0 : ((Math.atan2(b, a) / RADIANS) + 360) % 360;
}

function hueDifference(hp: number, hq: number, zero: boolean): number {
  if (zero) return 0;
  const diff = hq - hp;
  if (diff > 180) return diff - 360;
  return diff < -180 ? diff + 360 : diff;
}

function meanHue(hp: number, hq: number, zero: boolean): number {
  if (zero) return hp + hq;
  if (Math.abs(hp - hq) <= 180) return (hp + hq) / 2;
  return (hp + hq < 360 ? hp + hq + 360 : hp + hq - 360) / 2;
}

/** CIEDE2000, Sharma, Wu, Dalal 2005: https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/ciede2000noteCRNA.pdf */
export function deltaE2000(p: Lab, q: Lab): number {
  const meanChroma = (Math.hypot(p[1], p[2]) + Math.hypot(q[1], q[2])) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + POW25_7)));
  const [ap, aq] = [(1 + g) * p[1], (1 + g) * q[1]];
  const [cp, cq] = [Math.hypot(ap, p[2]), Math.hypot(aq, q[2])];
  const [hp, hq] = [hueDegrees(p[2], ap), hueDegrees(q[2], aq)];
  const achromatic = cp * cq === 0;
  const dh = hueDifference(hp, hq, achromatic);
  const dH = 2 * Math.sqrt(cp * cq) * Math.sin((dh / 2) * RADIANS);
  const [meanL, meanC, mh] = [(p[0] + q[0]) / 2, (cp + cq) / 2, meanHue(hp, hq, achromatic)];
  const t = 1 - 0.17 * Math.cos((mh - 30) * RADIANS) + 0.24 * Math.cos(2 * mh * RADIANS)
    + 0.32 * Math.cos((3 * mh + 6) * RADIANS) - 0.2 * Math.cos((4 * mh - 63) * RADIANS);
  const rotation = -Math.sin(60 * Math.exp(-(((mh - 275) / 25) ** 2)) * RADIANS) * 2 * Math.sqrt(meanC ** 7 / (meanC ** 7 + POW25_7));
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const [tl, tc, th] = [(q[0] - p[0]) / sl, (cq - cp) / (1 + 0.045 * meanC), dH / (1 + 0.015 * meanC * t)];
  return Math.sqrt(tl * tl + tc * tc + th * th + rotation * tc * th);
}

export function colourDistance(hexA: string, hexB: string): number {
  return deltaE2000(rgbToLab(hexToRgb(hexA)), rgbToLab(hexToRgb(hexB)));
}
