import { describe, expect, it } from "vitest";
import { MAC_APP_CLI, createTailscaleProbe, describeState, inspectTailscale, stateLabel, tailscaleCommandsFor } from "./tailscale.js";
import type { TailscaleState } from "./tailscale.js";

type Script = { status: string | Error; ip: string | Error };

function scripted(script: Script): (command: string, args: string[]) => Promise<string> {
  return async (_command, args) => {
    const answer = args[0] === "status" ? script.status : script.ip;
    if (answer instanceof Error) throw answer;
    return Promise.resolve(answer);
  };
}

const state = (backend: string): string => JSON.stringify({ BackendState: backend });

describe("inspectTailscale", () => {
  it.each([
    ["Running", "100.64.0.9\n", { kind: "running", address: "100.64.0.9" }],
    ["Stopped", "", { kind: "stopped" }],
    ["NeedsLogin", "", { kind: "logged-out" }],
    ["NeedsMachineAuth", "", { kind: "logged-out" }],
    ["Starting", "", { kind: "no-address", backend: "Starting" }],
    ["Running", "not an address", { kind: "no-address", backend: "Running" }],
  ])("reads BackendState %s as %j", async (backend, ip, expected) => {
    expect(await inspectTailscale("tailscale", scripted({ status: state(backend), ip }))).toEqual(expected);
  });

  it("treats unreadable output as no address, a missing command as not installed, any other failure as unreachable", async () => {
    expect(await inspectTailscale("tailscale", scripted({ status: "{not json", ip: "" }))).toEqual({ kind: "no-address", backend: "unknown" });
    expect(await inspectTailscale("tailscale", scripted({ status: new Error("spawn tailscale ENOENT"), ip: "" }))).toEqual({ kind: "not-installed" });
    expect(await inspectTailscale("tailscale", scripted({ status: new Error("failed to connect to local tailscaled"), ip: "" }))).toEqual({ kind: "unreachable" });
  });

  it("reports a running daemon whose `ip -4` fails as no address", async () => {
    expect(await inspectTailscale("tailscale", scripted({ status: state("Running"), ip: new Error("no ip") }))).toEqual({ kind: "no-address", backend: "Running" });
  });
});

describe("tailscaleCommandsFor", () => {
  it("adds the Mac app's own CLI only on macOS when it exists", () => {
    expect(tailscaleCommandsFor("darwin", true)).toEqual(["tailscale", MAC_APP_CLI]);
    expect(tailscaleCommandsFor("darwin", false)).toEqual(["tailscale"]);
    expect(tailscaleCommandsFor("linux", true)).toEqual(["tailscale"]);
  });
});

describe("createTailscaleProbe", () => {
  function twoCommands(): { run: (command: string, args: string[]) => Promise<string>; calls: string[] } {
    const calls: string[] = [];
    const run = async (command: string, args: string[]): Promise<string> => {
      calls.push(command);
      if (command === "path-cli") throw new Error("failed to connect to local tailscaled");
      return scripted({ status: state("Running"), ip: "100.64.0.3" })(command, args);
    };
    return { run, calls };
  }

  it("falls back to the second command, logs which one it uses once, and sticks to it", async () => {
    const { run, calls } = twoCommands();
    const lines: string[] = [];
    const probe = createTailscaleProbe(["path-cli", "app-cli"], run, (line) => lines.push(line));
    expect(await probe()).toEqual({ kind: "running", address: "100.64.0.3" });
    expect(await probe()).toEqual({ kind: "running", address: "100.64.0.3" });
    expect(lines).toEqual(["using tailscale command app-cli"]);
    expect(calls.filter((command) => command === "path-cli")).toHaveLength(1);
  });

  it("keeps trying every command while none reaches a daemon and prefers unreachable over not installed", async () => {
    const run = (command: string): Promise<string> => Promise.reject(new Error(command === "missing" ? "spawn missing ENOENT" : "failed to connect"));
    const lines: string[] = [];
    expect(await createTailscaleProbe(["missing", "broken"], run, (line) => lines.push(line))()).toEqual({ kind: "unreachable" });
    expect(await createTailscaleProbe(["missing"], run, (line) => lines.push(line))()).toEqual({ kind: "not-installed" });
    expect(lines).toEqual([]);
  });
});

describe("state texts", () => {
  const cases: [TailscaleState, string, string][] = [
    [{ kind: "not-installed" }, "not installed", "Tailscale: not installed"],
    [{ kind: "unreachable" }, "stopped", "Tailscale is stopped on this computer"],
    [{ kind: "stopped" }, "stopped", "Tailscale is stopped on this computer"],
    [{ kind: "logged-out" }, "logged out", "Tailscale: logged out, run tailscale up"],
    [{ kind: "no-address", backend: "Starting" }, "no tailnet address yet (Starting)", "Tailscale: no tailnet address yet (Starting)"],
    [{ kind: "running", address: "100.64.0.1" }, "running", "Tailscale: running, address 100.64.0.1"],
  ];
  it.each(cases)("%j", (value, label, sentence) => {
    expect(stateLabel(value)).toBe(label);
    expect(describeState(value)).toBe(sentence);
  });
});
