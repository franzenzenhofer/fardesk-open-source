// Shared HTTP assertions for the route tests.
import { existsSync, readFileSync } from "node:fs";
import { expect } from "vitest";
import { errorResponseSchema, killResultSchema, okResultSchema } from "../../src/contract/schema.js";
import type { TestDaemon } from "./daemon.js";
import { waitUntil } from "./env.js";

export type ErrorExpectation = [method: string, path: string, status: number, code: string, body?: unknown];

// Calls the daemon, expects an ErrorResponse with that status and code, returns its message.
export async function expectApiError(daemon: TestDaemon, ...expectation: ErrorExpectation): Promise<string> {
  const [method, path, status, code, body] = expectation;
  const response = await daemon.call(method, path, body);
  expect(response.status).toBe(status);
  const error = errorResponseSchema.parse(response.json).error;
  expect(error.code).toBe(code);
  return error.message;
}

/** A kill answers ok plus what it closed. */
export async function expectApiKilled(daemon: TestDaemon, path: string, body?: unknown): Promise<string> {
  const response = await daemon.call("POST", path, body);
  expect(response.status).toBe(200);
  return killResultSchema.parse(response.json).closed;
}

export async function expectApiOk(daemon: TestDaemon, path: string, body?: unknown): Promise<void> {
  const response = await daemon.call("POST", path, body);
  expect(response.status).toBe(200);
  expect(okResultSchema.parse(response.json)).toEqual({ ok: true });
}

// Stops the session through the API and expects the program in its tmux pane to read exactly one Escape byte into target.
export async function expectStopSendsEscape(daemon: TestDaemon, id: string, target: string): Promise<void> {
  await expectApiOk(daemon, `/v1/sessions/${id}/stop`);
  await waitUntil(() => existsSync(target) && readFileSync(target).length === 1);
  expect([...readFileSync(target)]).toEqual([0x1b]);
}
