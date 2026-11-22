// Shared helpers for tests. Real temp dirs, real ports, real waiting. No mocks.
import { mkdtempSync, realpathSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_WAIT_MS = 15_000;
const WAIT_STEP_MS = 20;

export const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES_DIR, ...parts);
}

// Short real path (macOS tmpdir is a symlink; Unix socket paths must stay under 104 bytes).
export function makeTempDir(prefix = "fd-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("no port assigned"));
        return;
      }
      server.close(() => {
        resolve(address.port);
      });
    });
  });
}

// True when something accepts TCP connections on that local port.
export async function portAccepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(port, "127.0.0.1");
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilAsync(check: () => Promise<boolean>, timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`waitUntilAsync timed out after ${timeoutMs} ms`);
    await sleep(WAIT_STEP_MS);
  }
}

export async function waitUntil(check: () => boolean, timeoutMs = DEFAULT_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`waitUntil timed out after ${timeoutMs} ms`);
    await sleep(WAIT_STEP_MS);
  }
}
