// The chat image of a session: upload (raw JPEG or PNG bytes), clear and download. The hash is part of the session label.
import type { ImageResult } from "../contract/schema.js";
import { MAX_IMAGE_BYTES } from "../service/imageStore.js";
import type { Services } from "../service/types.js";
import { readBoundedBody } from "./boundedBody.js";
import type { App } from "./context.js";

// The URL stays the same when the picture changes; an app adds the label hash as ?v=<hash> so its cache fetches the new bytes (the daemon ignores the query).
const IMAGE_CACHE_CONTROL = "private, max-age=31536000, immutable";

export function registerImageRoutes(app: App, services: Services): void {
  app.post("/v1/sessions/:id/image", async (c) => {
    const bytes = await readBoundedBody(c.req.raw, MAX_IMAGE_BYTES);
    const image = services.setSessionImage(c.req.param("id"), { mediaType: c.req.header("content-type") ?? "", bytes });
    return c.json({ ok: true, image } satisfies ImageResult);
  });
  app.post("/v1/sessions/:id/image/clear", (c) => {
    services.clearSessionImage(c.req.param("id"));
    return c.json({ ok: true });
  });
  app.get("/v1/sessions/:id/image", (c) => {
    const stored = services.readSessionImage(c.req.param("id"));
    return c.body(stored.bytes, 200, { "content-type": stored.mediaType, "cache-control": IMAGE_CACHE_CONTROL });
  });
}
