// Routes that take data in from the apps: error reports (telemetry) and uploaded attachments.
import { z } from "zod";
import { MAX_ATTACHMENT_BYTES } from "../attachments/store.js";
import { notificationPauseRequestSchema, telemetryBatchSchema } from "../contract/schema.js";
import type { Services } from "../service/types.js";
import { DEFAULT_TELEMETRY_LIMIT, MAX_TELEMETRY_LIMIT } from "../telemetry/store.js";
import { readBoundedBody } from "./boundedBody.js";
import type { App } from "./context.js";
import { parseBody, parseWith } from "./validate.js";

const FILENAME_HEADER = "x-fardesk-filename";
const telemetryQuerySchema = z.strictObject({
  since: z.iso.datetime().optional(),
  kind: z.enum(["error", "event"]).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_TELEMETRY_LIMIT).default(DEFAULT_TELEMETRY_LIMIT),
});

const attachmentQuerySchema = z.strictObject({ path: z.string().min(1) });

export function registerIntakeRoutes(app: App, services: Services): void {
  app.post("/v1/telemetry", async (c) => c.json(services.reportTelemetry((await parseBody(c, telemetryBatchSchema)).reports)));
  app.get("/v1/telemetry", (c) => {
    const query = parseWith(telemetryQuerySchema, c.req.query(), "query");
    return c.json({ reports: services.telemetry(query) });
  });
  app.get("/v1/notifications", (c) => c.json(services.notificationState()));
  app.post("/v1/notifications/pause", async (c) => c.json(services.pauseNotifications((await parseBody(c, notificationPauseRequestSchema)).minutes)));
  app.post("/v1/sessions/:id/attachments", async (c) => {
    const mediaType = c.req.header("content-type") ?? "";
    const filename = c.req.header(FILENAME_HEADER) ?? null;
    const bytes = await readBoundedBody(c.req.raw, MAX_ATTACHMENT_BYTES);
    return c.json(services.saveAttachment(c.req.param("id"), { mediaType, filename, bytes }));
  });
  app.get("/v1/sessions/:id/attachment", (c) => {
    const { path } = parseWith(attachmentQuerySchema, c.req.query(), "query");
    const stored = services.readAttachment(c.req.param("id"), path);
    return c.body(stored.bytes, 200, { "content-type": stored.mediaType });
  });
}
