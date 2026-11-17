import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { makeTempDir } from "../../test/support/env.js";
import { FardeskError } from "./errors.js";
import { readJsonState, writeJsonState } from "./jsonState.js";

const schema = z.strictObject({ items: z.array(z.string()) });
const EMPTY = { items: [] };

describe("json state files", () => {
  it("returns the fallback for a missing file and round-trips a written one, privately", () => {
    const path = join(makeTempDir(), "state", "x.json");
    expect(readJsonState(path, schema, "thing", EMPTY)).toEqual(EMPTY);
    writeJsonState(path, { items: ["a"] });
    expect(readJsonState(path, schema, "thing", EMPTY)).toEqual({ items: ["a"] });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ items: ["a"] });
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("fails loudly on a corrupt file and on an unreadable one", () => {
    const dir = makeTempDir();
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, '{"items": "nope"}');
    expect(() => readJsonState(corrupt, schema, "thing", EMPTY)).toThrow(FardeskError);
    expect(() => readJsonState(corrupt, schema, "thing", EMPTY)).toThrow(/thing .* is corrupt/);
    const directory = join(dir, "dir.json");
    mkdirSync(directory);
    expect(() => readJsonState(directory, schema, "thing", EMPTY)).toThrow(/EISDIR/);
  });

  it("fails when the file cannot be written", () => {
    const dir = makeTempDir();
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file where a directory is needed");
    expect(() => { writeJsonState(join(blocker, "x.json"), {}); }).toThrow();
  });
});
