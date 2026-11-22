import { forkSession } from "@anthropic-ai/claude-agent-sdk";
import { CLAUDE_CONFIG_ENV } from "./claudeEnv.js";

let queue: Promise<unknown> = Promise.resolve();

async function forkWithHome(sessionId: string, cwd: string, home: string): Promise<string> {
  const previous = process.env[CLAUDE_CONFIG_ENV];
  process.env[CLAUDE_CONFIG_ENV] = home;
  try {
    return (await forkSession(sessionId, { dir: cwd })).sessionId;
  } finally {
    Reflect.deleteProperty(process.env, CLAUDE_CONFIG_ENV);
    if (previous !== undefined) process.env[CLAUDE_CONFIG_ENV] = previous;
  }
}

/**
 * Copies a session inside the Claude home `home` and returns the copy's id. The SDK's forkSession has no home option
 * (SessionMutationOptions only knows `dir`) and reads CLAUDE_CONFIG_DIR from the process environment, so the variable is
 * set for the duration of the call. Calls run one after the other: two forks in two homes must not see each other's value.
 */
export function forkInHome(sessionId: string, cwd: string, home: string): Promise<string> {
  const result = queue.then(() => forkWithHome(sessionId, cwd, home));
  queue = result.catch(() => undefined);
  return result;
}
