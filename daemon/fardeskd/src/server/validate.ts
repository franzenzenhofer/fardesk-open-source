// Request validation with the contract schemas: every failure is an `invalid_request`.
import type { Context } from "hono";
import type { z } from "zod";
import { FardeskError } from "../core/errors.js";
import { MAX_JSON_BYTES, readBoundedBody } from "./boundedBody.js";

function describe(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
}

export function parseWith<S extends z.ZodType>(schema: S, value: unknown, what: string): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new FardeskError("invalid_request", `invalid ${what}: ${describe(parsed.error)}`);
  return parsed.data;
}

function parseJsonText<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new FardeskError("invalid_request", "request body is not valid JSON");
  }
  return parseWith(schema, json, "request body");
}

export async function parseBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  return parseJsonText((await readBoundedBody(c.req.raw, MAX_JSON_BYTES, false)).toString("utf8"), schema);
}

/** Like `parseBody`, but an empty body gives `fallback`. */
export async function parseOptionalBody<S extends z.ZodType>(c: Context, schema: S, fallback: z.infer<S>): Promise<z.infer<S>> {
  const text = (await readBoundedBody(c.req.raw, MAX_JSON_BYTES, false)).toString("utf8");
  return text.trim().length === 0 ? fallback : parseJsonText(text, schema);
}
