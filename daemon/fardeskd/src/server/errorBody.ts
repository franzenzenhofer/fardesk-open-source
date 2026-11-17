import type { z } from "zod";
import type { ErrorCode, errorResponseSchema } from "../contract/schema.js";

export function errorBody(code: ErrorCode, message: string): z.infer<typeof errorResponseSchema> {
  return { error: { code, message } };
}
