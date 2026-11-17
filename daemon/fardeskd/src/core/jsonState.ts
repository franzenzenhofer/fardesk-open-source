// Our own small state files (devices, mutes): strict zod schema on read, private atomic write.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { FardeskError } from "./errors.js";

const FILE_MODE = 0o600;
const DIR_MODE = 0o700;

export function readJsonState<S extends z.ZodType>(path: string, schema: S, label: string, whenMissing: z.infer<S>): z.infer<S> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return whenMissing;
    throw error;
  }
  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    throw new FardeskError("internal", `${label} ${path} is corrupt: ${(error as Error).message}`);
  }
}

export function writeJsonState(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: DIR_MODE });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: FILE_MODE });
  renameSync(temp, path);
}
