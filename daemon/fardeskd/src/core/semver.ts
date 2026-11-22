// Version comparison for release numbers like 4.2.0 or 4.3.0-beta.1 (a pre-release is older than its release).
import { FardeskError } from "./errors.js";

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

type Parsed = { core: [number, number, number]; pre: string[] };

function parse(version: string): Parsed {
  const match = VERSION_PATTERN.exec(version);
  if (match === null) throw new FardeskError("invalid_request", `"${version}" is not a version number like 4.2.0`);
  const [, major = "0", minor = "0", patch = "0", pre] = match;
  return { core: [Number(major), Number(minor), Number(patch)], pre: pre === undefined ? [] : pre.split(".") };
}

function comparePart(a: string, b: string): number {
  const numeric = /^\d+$/;
  if (numeric.test(a) && numeric.test(b)) return Math.sign(Number(a) - Number(b));
  if (numeric.test(a)) return -1;
  if (numeric.test(b)) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return Math.sign(b.length - a.length);
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    const order = comparePart(a[index] ?? "", b[index] ?? "");
    if (order !== 0) return order;
  }
  return Math.sign(a.length - b.length);
}

/** -1 when `a` is older than `b`, 0 when equal, 1 when newer. Throws `invalid_request` for a text that is no version. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < left.core.length; index += 1) {
    const order = Math.sign((left.core[index] ?? 0) - (right.core[index] ?? 0));
    if (order !== 0) return order;
  }
  return comparePre(left.pre, right.pre);
}

export const isOlder = (version: string, than: string): boolean => compareVersions(version, than) < 0;
