import { describe, expect, it } from "vitest";
import { timestamped } from "./timestamped.js";

describe("timestamped", () => {
  it("prefixes every line with the ISO UTC time of the moment it is written", () => {
    const lines: string[] = [];
    const times = [new Date("2026-11-22T08:48:30.029Z"), new Date("2026-11-22T08:48:32.500Z")];
    const write = timestamped((line) => lines.push(line), () => times.shift() ?? new Date(0));
    write("waiting for Tailscale: stopped");
    write("tailnet address 100.64.0.1");
    expect(lines).toEqual([
      "2026-11-22T08:48:30.029Z waiting for Tailscale: stopped",
      "2026-11-22T08:48:32.500Z tailnet address 100.64.0.1",
    ]);
  });
});
