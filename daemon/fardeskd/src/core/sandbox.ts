// Test sandbox guard. When FARDESK_TEST_SANDBOX names a directory (the test runner's temp dir), every delivery into the
// outside world (session inbox socket, tmux pane, osascript) must target something inside it, or it throws. A test can then
// never type into a real Claude session, tmux pane or Ghostty terminal of the person running it. Unset in production.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { FardeskError } from "./errors.js";

export const SANDBOX_ENV = "FARDESK_TEST_SANDBOX";
export const SANDBOX_TMUX_PREFIX = "fardesk-test-";

function root(): string | null {
  const value = process.env[SANDBOX_ENV];
  return value === undefined || value === "" ? null : value;
}

/** True inside the test runner's sandbox: the only place where a loopback address stands in for the tailnet. */
export function inTestSandbox(): boolean {
  return root() !== null;
}

function refuse(what: string, target: string): never {
  throw new FardeskError("internal", `${SANDBOX_ENV} is set: refusing ${what} outside the test sandbox: ${target}`);
}

/** Throws under the sandbox unless `path` lies inside the sandbox directory. */
export function assertSandboxPath(what: string, path: string): void {
  const sandbox = root();
  if (sandbox !== null && !path.startsWith(`${sandbox}/`)) refuse(what, path);
}

function wrapsPrivateServer(binary: string): boolean {
  try {
    return readFileSync(binary, "utf8").includes(`-L ${SANDBOX_TMUX_PREFIX}`);
  } catch {
    return false;
  }
}

/** Throws under the sandbox unless the tmux target is a private test server: `-S <fardesk-test-*>` or a wrapper script that runs `tmux -L fardesk-test-*`. */
export function assertSandboxTmux(binary: string, socket: string | null | undefined): void {
  if (root() === null) return;
  assertSandboxPath("tmux binary", binary);
  const private_ = socket === null || socket === undefined ? wrapsPrivateServer(binary) : basename(socket).startsWith(SANDBOX_TMUX_PREFIX);
  if (!private_) refuse("tmux input to a server that is not a fardesk-test one", socket ?? binary);
}

/** Under the sandbox the server a bare `tmux <args>` reaches is looked at only when the binary wraps a private test server. */
export function sandboxAllowsDefaultServer(binary: string): boolean {
  return root() === null || wrapsPrivateServer(binary);
}

/** Under the sandbox only fardesk-test-* tmux sockets are looked at; elsewhere every socket is. */
export function sandboxAllowsSocket(path: string): boolean {
  return root() === null || basename(path).startsWith(SANDBOX_TMUX_PREFIX);
}

/**
 * Under the sandbox a daemon ends when the process that started it is gone. A test run that is killed (a timeout, an
 * agent stopping it) never runs its teardown, and its daemons used to live on: 154 of them on 2026-11-21, each still
 * polling and spawning tools. Outside the sandbox nothing is watched. Returns a function that stops the watch.
 */
export function endWithParent(parentPid: () => number, onGone: () => void, everyMs: number): () => void {
  if (root() === null) return () => undefined;
  const first = parentPid();
  const timer = setInterval(() => {
    if (parentPid() === first) return;
    clearInterval(timer);
    onGone();
  }, everyMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
