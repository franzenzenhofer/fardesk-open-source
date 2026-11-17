import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempDir } from "../../test/support/env.js";
import { createStateFile } from "./stateFile.js";

const ENTRY = { sessionId: "11111111-1111-4111-8111-111111111111", cwd: "/tmp/x", model: null };

describe("state file", () => {
  it("reads an absent file as empty and round-trips entries with mode 600 and no temp leftover", () => {
    const dir = makeTempDir();
    const file = createStateFile(join(dir, "nested", "owned.json"));
    expect(file.read()).toEqual([]);
    file.write([ENTRY, { ...ENTRY, sessionId: "22222222-2222-4222-8222-222222222222", model: "haiku" }]);
    expect(file.read()).toHaveLength(2);
    expect(statSync(join(dir, "nested", "owned.json")).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(dir, "nested"))).toEqual(["owned.json"]);
  });

  it("fails loudly on bad JSON or an entry with an unknown field", () => {
    const path = join(makeTempDir(), "owned.json");
    const file = createStateFile(path);
    writeFileSync(path, "{nope");
    expect(() => file.read()).toThrow(/corrupt/);
    writeFileSync(path, JSON.stringify([{ ...ENTRY, extra: 1 }]));
    expect(() => file.read()).toThrow(/corrupt/);
  });

  it("rethrows read errors other than a missing file", () => {
    const file = createStateFile(makeTempDir());
    expect(() => file.read()).toThrow(/EISDIR/);
  });
});
