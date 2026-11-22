import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { expectApiError } from "../../test/support/apiAssert.js";
import { startTestDaemon } from "../../test/support/daemon.js";
import type { TestDaemon } from "../../test/support/daemon.js";
import { waitUntil } from "../../test/support/env.js";
import {
  activityDetailSchema,
  activityPageSchema,
  coordinatorStateSchema,
  errorResponseSchema,
  folderSearchSchema,
  machineSchema,
  recentFoldersSchema,
  sessionSummarySchema,
} from "../contract/schema.js";

let daemon: TestDaemon;

beforeEach(async () => {
  daemon = await startTestDaemon();
});

afterEach(async () => {
  await daemon.close();
});

async function seed(fixture: string, registry: "busy" | "idle" | null): Promise<string> {
  const { sessionId } = daemon.home.addTranscript({ fixture });
  if (registry !== null) daemon.home.addRegistry({ fixture: registry, sessionId });
  await waitUntil(() => daemon.services.sessions().some((session) => session.id === sessionId));
  return sessionId;
}

function parsed<S extends z.ZodType>(schema: S, json: unknown): z.infer<S> {
  return schema.parse(json);
}

describe("authentication", () => {
  it.each([
    ["no header", null],
    ["a wrong token", "x".repeat(48)],
    ["an empty token", ""],
  ])("rejects %s with 401 on every route", async (_name, token) => {
    for (const [method, path] of [["GET", "/v1/machine"], ["POST", "/v1/devices"], ["GET", "/v1/nowhere"]] as const) {
      const response = await daemon.call(method, path, undefined, token);
      expect(response.status).toBe(401);
      expect(errorResponseSchema.parse(response.json).error.code).toBe("unauthorized");
    }
  });

  it("rejects an authorization header that is not a bearer token", async () => {
    const response = await daemon.fetch(`/v1/machine`, { headers: { authorization: `Basic ${daemon.config.token}` } });
    expect(response.status).toBe(401);
  });
});

describe("routing errors", () => {
  it("answers 404 with an ErrorResponse for unknown routes and methods", async () => {
    await expectApiError(daemon, "GET", "/v1/nowhere", 404, "not_found");
    await expectApiError(daemon, "DELETE", "/v1/sessions", 404, "not_found");
  });
});

describe("read routes", () => {
  it("returns the machine", async () => {
    const machine = parsed(machineSchema, (await daemon.call("GET", "/v1/machine")).json);
    expect(machine).toMatchObject({ name: "test-mac", sessionsCount: 0, os: process.platform === "darwin" ? "macos" : "linux" });
    expect(machine.models).toEqual(daemon.config.models);
    expect(machine.claudeVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("lists sessions", async () => {
    const id = await seed("01b-minimal-session", "busy");
    const response = await daemon.call("GET", "/v1/sessions");
    const sessions = parsed(sessionSummarySchema.array(), response.json);
    expect(sessions.map((session) => session.id)).toEqual([id]);
    expect(sessions[0]?.status).toBe("working");
    expect(parsed(machineSchema, (await daemon.call("GET", "/v1/machine")).json).sessionsCount).toBe(1);
  });

  it("pages the activity feed", async () => {
    const id = await seed("01-simple-session", null);
    const all = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity?limit=1000`)).json);
    expect(all.nextBefore).toBeNull();
    const newest = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity?limit=2`)).json);
    expect(newest.items).toEqual(all.items.slice(-2));
    const older = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity?limit=2&before=${newest.nextBefore}`)).json);
    expect(older.items).toEqual(all.items.slice(-4, -2));
    const defaulted = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity`)).json);
    expect(defaulted.items.length).toBe(Math.min(all.items.length, daemon.config.activityPageLimit.default));
  });

  it("clamps the page size to the configured maximum", async () => {
    const id = await seed("01-simple-session", null);
    const page = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity?limit=100000`)).json);
    expect(page.items.length).toBeLessThanOrEqual(daemon.config.activityPageLimit.max);
  });

  it("rejects bad activity queries and unknown sessions", async () => {
    const id = await seed("01b-minimal-session", null);
    for (const query of ["limit=0", "limit=abc", "limit=1.5", "before=nope", "unknown=1"]) {
      await expectApiError(daemon, "GET", `/v1/sessions/${id}/activity?${query}`, 400, "invalid_request");
    }
    await expectApiError(daemon, "GET", "/v1/sessions/nope/activity", 404, "not_found");
  });

  it("returns the detail of an activity", async () => {
    const id = await seed("05-edit-write-read-test-run", null);
    const page = parsed(activityPageSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity?limit=1000`)).json);
    const row = page.items.find((item) => item.kind === "tool" && item.hasDetail);
    const detail = parsed(activityDetailSchema, (await daemon.call("GET", `/v1/sessions/${id}/activity/${row?.id}/detail`)).json);
    expect(detail.activityId).toBe(row?.id);
    await expectApiError(daemon, "GET", `/v1/sessions/${id}/activity/nope/detail`, 404, "not_found");
    await expectApiError(daemon, "GET", "/v1/sessions/nope/activity/x/detail", 404, "not_found");
  });

  it("reports no coordinator session before one is started, and needs the bearer token", async () => {
    expect(parsed(coordinatorStateSchema, (await daemon.call("GET", "/v1/coordinator")).json)).toEqual({ sessionId: null });
    expect((await daemon.call("GET", "/v1/coordinator", undefined, null)).status).toBe(401);
  });

  it("searches folders by name and validates the query", async () => {
    await seed("01b-minimal-session", null);
    const found = parsed(folderSearchSchema, (await daemon.call("GET", "/v1/folders/search?q=DEV&limit=2")).json);
    expect(found.folders[0]).toEqual({ path: "/Users/dev/dev", recent: true });
    expect(found.folders.length).toBeLessThanOrEqual(2);
    await expectApiError(daemon, "GET", "/v1/folders/search", 400, "invalid_request");
    await expectApiError(daemon, "GET", "/v1/folders/search?q=x&limit=31", 400, "invalid_request");
    expect((await daemon.call("GET", "/v1/folders/search?q=x", undefined, null)).status).toBe(401);
  });

  it("lists recent folders", async () => {
    await seed("01b-minimal-session", null);
    const folders = parsed(recentFoldersSchema, (await daemon.call("GET", "/v1/folders/recent")).json);
    expect(folders.folders.map((folder) => folder.path)).toEqual(["/Users/dev/dev"]);
  });
});
