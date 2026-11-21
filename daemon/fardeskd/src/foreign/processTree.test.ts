import { describe, expect, it } from "vitest";
import type { RunCommand } from "../config/bind.js";
import { readProcessTable } from "./processTree.js";

const TABLE = "  1     0 ??       launchd\n 42     1 ttys001  -zsh\n";

/** A ps that answers only when told to, and counts how often it was started. */
function slowPs(): { run: RunCommand; starts: () => number; answer: () => void } {
  let starts = 0;
  let release: (() => void) | null = null;
  const run: RunCommand = async () => {
    starts += 1;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return TABLE;
  };
  return { run, starts: () => starts, answer: () => release?.() };
}

describe("readProcessTable", () => {
  it("shares one running ps among callers that arrive while it runs", async () => {
    const ps = slowPs();
    const reads = [readProcessTable(ps.run), readProcessTable(ps.run), readProcessTable(ps.run)];
    expect(ps.starts()).toBe(1);
    ps.answer();
    const tables = await Promise.all(reads);
    expect(tables.map((table) => table.get(42)?.tty)).toEqual(["ttys001", "ttys001", "ttys001"]);
  });

  it("starts a fresh ps once the previous one has answered or failed", async () => {
    const ps = slowPs();
    const first = readProcessTable(ps.run);
    ps.answer();
    await first;
    const second = readProcessTable(ps.run);
    expect(ps.starts()).toBe(2);
    ps.answer();
    await second;
    let calls = 0;
    const failing: RunCommand = () => {
      calls += 1;
      return Promise.reject(new Error("ps did not answer within 20 s"));
    };
    await expect(readProcessTable(failing)).rejects.toThrow("did not answer");
    await expect(readProcessTable(failing)).rejects.toThrow("did not answer");
    expect(calls).toBe(2);
  });
});
