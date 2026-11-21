import { describe, expect, it } from "vitest";
import { CLAUDE_CONFIG_ENV, claudeHomeEnv } from "./claudeEnv.js";

const HOME = "/home/dev";

describe("claudeHomeEnv", () => {
  it("drops an inherited home when the session belongs to the default home", () => {
    const env = claudeHomeEnv(`${HOME}/.claude/`, { [CLAUDE_CONFIG_ENV]: `${HOME}/.claude-other`, PATH: "/bin" }, HOME);
    expect(env).toEqual({ PATH: "/bin" });
    expect(CLAUDE_CONFIG_ENV in env).toBe(false);
  });

  it("points claude at a second home, replacing the inherited one", () => {
    const env = claudeHomeEnv(`${HOME}/.claude-work`, { [CLAUDE_CONFIG_ENV]: `${HOME}/.claude-other` }, HOME);
    expect(env[CLAUDE_CONFIG_ENV]).toBe(`${HOME}/.claude-work`);
  });

  it("leaves the caller's environment untouched", () => {
    const base = { [CLAUDE_CONFIG_ENV]: `${HOME}/.claude-other` };
    claudeHomeEnv(`${HOME}/.claude`, base, HOME);
    expect(base[CLAUDE_CONFIG_ENV]).toBe(`${HOME}/.claude-other`);
  });

  it("uses the real user home by default", () => {
    expect(claudeHomeEnv("/elsewhere/claude-home", {})[CLAUDE_CONFIG_ENV]).toBe("/elsewhere/claude-home");
  });
});
