import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildArtifacts, fixtureRelativePath, writeArtifacts } from "./artifacts.js";
import { contractNames } from "./jsonSchema.js";

const COMMITTED_SCHEMA_DIR = resolve(import.meta.dirname, "..", "..", "schema");

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

let workDir = "";

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "fardesk-schema-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("artifact generation", () => {
  it("builds one schema per contract name plus the fixtures", () => {
    const paths = [...buildArtifacts().keys()];
    for (const name of contractNames()) expect(paths).toContain(`${name}.schema.json`);
    expect(paths).toContain(fixtureRelativePath("SessionSummary", "working"));
  });

  it("writes exactly the built files and returns their paths", async () => {
    const written = await writeArtifacts(workDir);
    expect([...written].sort()).toEqual([...buildArtifacts().keys()].sort());
    expect(await listFiles(workDir)).toEqual([...buildArtifacts().keys()].sort());
  });

  it("is idempotent and removes nothing else", async () => {
    const extra = join(workDir, "notes", "keep.txt");
    await mkdir(dirname(extra), { recursive: true });
    await writeFile(extra, "keep me", "utf8");
    await writeArtifacts(workDir);
    const first = await readFile(join(workDir, "Machine.schema.json"), "utf8");
    await writeArtifacts(workDir);
    expect(await readFile(join(workDir, "Machine.schema.json"), "utf8")).toBe(first);
    expect(await readFile(extra, "utf8")).toBe("keep me");
  });
});

describe("committed schema directory is in sync with the contract", () => {
  it("has exactly the generated files with identical bytes (run npm run schema after a contract change)", async () => {
    await writeArtifacts(workDir);
    const generated = await listFiles(workDir);
    expect(await listFiles(COMMITTED_SCHEMA_DIR)).toEqual(generated);
    for (const file of generated) {
      expect(await readFile(join(COMMITTED_SCHEMA_DIR, file), "utf8")).toBe(await readFile(join(workDir, file), "utf8"));
    }
  });
});
