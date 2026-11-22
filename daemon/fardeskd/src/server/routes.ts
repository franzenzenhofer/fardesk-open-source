// Every route of the HTTP API (docs/DAEMON.md). Handlers validate, call the facade, return the contract body.
import { z } from "zod";
import type { DeviceRequest } from "../contract/schema.js";
import {
  answerRequestSchema,
  dialogAnswerRequestSchema,
  coordinatorRequestSchema,
  deviceRequestSchema,
  messageRequestSchema,
  killRequestSchema,
  labelRequestSchema,
  muteRequestSchema,
  newSessionRequestSchema,
  permissionRequestSchema,
} from "../contract/schema.js";
import { MASTER_DEVICE_ID } from "../auth/deviceRegistry.js";
import { FardeskError } from "../core/errors.js";
import { DEFAULT_FOLDER_LIMIT, MAX_FOLDER_LIMIT } from "../folders/search.js";
import type { Services } from "../service/types.js";
import type { App } from "./context.js";
import { registerAuthRoutes } from "./authRoutes.js";
import { registerImageRoutes } from "./imageRoutes.js";
import { registerIntakeRoutes } from "./intakeRoutes.js";
import { registerUpdateRoutes } from "./updateRoutes.js";
import { parseBody, parseOptionalBody, parseWith } from "./validate.js";

/** Extra work a hub does after a route ran. deviceRegistered: a phone registered its APNs token here. */
export type RouteHooks = { deviceRegistered?: (request: DeviceRequest) => Promise<void> };

const OK = { ok: true } as const;
const activityQuerySchema = z.strictObject({
  before: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const folderSearchQuerySchema = z.strictObject({
  q: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(MAX_FOLDER_LIMIT).default(DEFAULT_FOLDER_LIMIT),
});

const sessionListQuerySchema = z.strictObject({ scope: z.enum(["visible", "all"]).default("visible") });

function readRoutes(app: App, services: Services): void {
  app.get("/v1/machine", (c) => c.json(services.machine()));
  app.post("/v1/machine/ghostty/probe", async (c) => c.json({ ghosttyAutomation: await services.ghosttyProbe() }));
  app.get("/v1/sessions", (c) => {
    const query = parseWith(sessionListQuerySchema, c.req.query(), "query");
    return c.json(query.scope === "all" ? services.allSessions() : services.sessions());
  });
  app.get("/v1/sessions/hidden", (c) => c.json({ sessions: services.hiddenSessions() }));
  app.get("/v1/folders/recent", (c) => c.json(services.recentFolders()));
  app.get("/v1/folders/search", (c) => {
    const query = parseWith(folderSearchQuerySchema, c.req.query(), "query");
    return c.json(services.searchFolders(query.q, query.limit));
  });
  app.get("/v1/coordinator", (c) => c.json(services.coordinatorState()));
  app.get("/v1/sessions/:id/activity", (c) => {
    const query = parseWith(activityQuerySchema, c.req.query(), "query");
    return c.json(services.activity(c.req.param("id"), query));
  });
  app.get("/v1/sessions/:id/activity/:aid/detail", (c) => c.json(services.detail(c.req.param("id"), c.req.param("aid"))));
}

function commandRoutes(app: App, services: Services): void {
  app.post("/v1/sessions/:id/message", async (c) => {
    const request = await parseBody(c, messageRequestSchema);
    const outcome = await services.message(c.req.param("id"), request.text, request.attachments);
    return c.json(outcome === "queued" ? { ...OK, queued: true } : OK);
  });
  app.post("/v1/sessions/:id/stop", async (c) => {
    await services.stop(c.req.param("id"));
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/kill", async (c) => {
    const closed = await services.kill(c.req.param("id"), (await parseOptionalBody(c, killRequestSchema, { closeTab: false })).closeTab);
    return c.json({ ...OK, closed });
  });
}

/** What the user decides about a session on the phone: mute, hide, name and colour. */
function preferenceRoutes(app: App, services: Services): void {
  app.post("/v1/sessions/:id/mute", async (c) => {
    services.mute(c.req.param("id"), (await parseBody(c, muteRequestSchema)).muted);
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/hide", (c) => {
    services.hide(c.req.param("id"), true);
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/unhide", (c) => {
    services.hide(c.req.param("id"), false);
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/label", async (c) => {
    services.label(c.req.param("id"), await parseBody(c, labelRequestSchema));
    return c.json(OK);
  });
}

function decisionRoutes(app: App, services: Services, hooks: RouteHooks): void {
  app.post("/v1/sessions/:id/permission/:rid", async (c) => {
    const { decision, message } = await parseBody(c, permissionRequestSchema);
    await services.decide(c.req.param("id"), c.req.param("rid"), decision, message);
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/answer/:qid", async (c) => {
    await services.answer(c.req.param("id"), c.req.param("qid"), (await parseBody(c, answerRequestSchema)).option);
    return c.json(OK);
  });
  app.post("/v1/sessions/:id/dialog/:rid", async (c) => {
    await services.answerDialog(c.req.param("id"), c.req.param("rid"), (await parseBody(c, dialogAnswerRequestSchema)).answer);
    return c.json(OK);
  });
  app.post("/v1/devices", async (c) => {
    const request = await parseBody(c, deviceRequestSchema);
    services.registerDevice(request);
    services.auth.attachPush(c.get("deviceId"), request);
    await hooks.deviceRegistered?.(request);
    return c.json(OK);
  });
}

function sessionActionRoutes(app: App, services: Services): void {
  app.post("/v1/sessions/new", async (c) => c.json(await services.newSession(await parseBody(c, newSessionRequestSchema))));
  app.post("/v1/coordinator", async (c) => c.json(await services.coordinator((await parseBody(c, coordinatorRequestSchema)).prompt)));
  app.post("/v1/sessions/:id/resume", async (c) => c.json(await services.resume(c.req.param("id"))));
  app.post("/v1/sessions/:id/takeover", async (c) => c.json(await services.takeover(c.req.param("id"))));
  app.post("/v1/sessions/:id/fork", async (c) => c.json(await services.fork(c.req.param("id"))));
  app.post("/v1/sessions/:id/clear", async (c) => c.json(await services.clear(c.req.param("id"))));
  app.post("/v1/sessions/:id/compact", async (c) => c.json(await services.compact(c.req.param("id"))));
}

export function registerRoutes(app: App, services: Services, hooks: RouteHooks = {}): void {
  readRoutes(app, services);
  commandRoutes(app, services);
  preferenceRoutes(app, services);
  decisionRoutes(app, services, hooks);
  sessionActionRoutes(app, services);
  registerIntakeRoutes(app, services);
  registerImageRoutes(app, services);
  registerUpdateRoutes(app, services);
  registerAuthRoutes(app, services);
  app.post("/v1/homes/reload", (c) => {
    if (c.get("deviceId") !== MASTER_DEVICE_ID) throw new FardeskError("unauthorized", "only the master token can reload the Claude homes");
    return c.json(services.reloadHomes());
  });
}
