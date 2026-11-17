import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { FardeskError } from "../core/errors.js";

const FILE_MODE = 0o600;

const entrySchema = z.strictObject({
  sessionId: z.string().min(1),
  cwd: z.string().min(1),
  model: z.string().min(1).nullable(),
});
const stateSchema = z.array(entrySchema);

export type OwnedEntry = z.infer<typeof entrySchema>;

export type StateFile = {
  read(): OwnedEntry[];
  write(entries: OwnedEntry[]): void;
};

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function parseState(path: string, text: string): OwnedEntry[] {
  try {
    return stateSchema.parse(JSON.parse(text));
  } catch (error) {
    throw new FardeskError("internal", `owned-session state file ${path} is corrupt: ${String(error)}`);
  }
}

export function createStateFile(path: string): StateFile {
  return {
    read(): OwnedEntry[] {
      const text = readText(path);
      return text === null ? [] : parseState(path, text);
    },
    write(entries): void {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.tmp`;
      writeFileSync(temp, `${JSON.stringify(entries, null, 2)}\n`, { mode: FILE_MODE });
      chmodSync(temp, FILE_MODE);
      renameSync(temp, path);
    },
  };
}
