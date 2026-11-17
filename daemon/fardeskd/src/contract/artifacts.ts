import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { contractFixtures } from "./fixtures.js";
import { contractJsonSchema, contractNames, formatJson, schemaFileName } from "./jsonSchema.js";

export const FIXTURES_DIR = "fixtures";

export function fixtureRelativePath(name: string, caseName: string): string {
  return join(FIXTURES_DIR, name, `${caseName}.json`);
}

/** Every generated file as relative path to exact file content, in deterministic order. */
export function buildArtifacts(): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const name of contractNames()) {
    files.set(schemaFileName(name), formatJson(contractJsonSchema(name)));
    for (const [caseName, value] of Object.entries(contractFixtures[name]).sort(([a], [b]) => a.localeCompare(b))) {
      files.set(fixtureRelativePath(name, caseName), formatJson(value));
    }
  }
  return files;
}

export async function writeArtifacts(outDir: string): Promise<readonly string[]> {
  const files = buildArtifacts();
  for (const [relativePath, content] of files) {
    const target = join(outDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  return [...files.keys()];
}
