import { spawn, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { isProcessAlive } from "./processes.js";

describe("isProcessAlive", () => {
  it("is true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("is false for a real child that has exited", () => {
    const finished = spawnSync(process.execPath, ["-e", ""]);
    expect(finished.pid).toBeGreaterThan(0);
    expect(isProcessAlive(finished.pid)).toBe(false);
  });

  it("is true for a live child and false once it is killed and reaped", async () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 60000)"]);
    const pid = child.pid;
    if (pid === undefined) throw new Error("child did not start");
    expect(isProcessAlive(pid)).toBe(true);
    const exited = new Promise<void>((resolve) => child.once("exit", () => { resolve(); }));
    child.kill();
    await exited;
    expect(isProcessAlive(pid)).toBe(false);
  });

  it("counts a process owned by another user (pid 1, EPERM) as alive", () => {
    expect(process.getuid?.()).not.toBe(0);
    expect(isProcessAlive(1)).toBe(true);
  });

  it("rethrows errors that are neither ESRCH nor EPERM", () => {
    expect(() => isProcessAlive(1.5)).toThrow(TypeError);
  });
});
