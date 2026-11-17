// Reads a new password from stdin: prompted twice with echo off on a terminal, one line when piped.
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { FardeskError } from "../core/errors.js";

type Input = NodeJS.ReadStream;
type Prompts = { first: string; second: string };

const PROMPTS: Prompts = { first: "New password: ", second: "Repeat: " };

const silent = (): Writable =>
  new Writable({
    write(_chunk, _encoding, done): void {
      done();
    },
  });

async function firstLine(stdin: Input, terminal: boolean): Promise<string> {
  const lines = createInterface({ input: stdin, ...(terminal ? { output: silent(), terminal: true } : { crlfDelay: Infinity }) });
  try {
    for await (const line of lines) return line.replace(/\r$/, "");
  } finally {
    lines.close();
  }
  throw new FardeskError("invalid_request", "no password was provided on stdin");
}

async function prompt(stdin: Input, stderr: NodeJS.WritableStream, text: string): Promise<string> {
  stderr.write(text);
  const line = await firstLine(stdin, true);
  stderr.write("\n");
  return line;
}

export async function readPasswordInput(stdin: Input, stderr: NodeJS.WritableStream): Promise<string> {
  if (!stdin.isTTY) return firstLine(stdin, false);
  const first = await prompt(stdin, stderr, PROMPTS.first);
  const second = await prompt(stdin, stderr, PROMPTS.second);
  if (first !== second) throw new FardeskError("invalid_request", "the two entries do not match");
  return first;
}
