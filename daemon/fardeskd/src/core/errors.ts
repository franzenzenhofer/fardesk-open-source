import type { ErrorCode } from "../contract/schema.js";

export const HTTP_STATUS: Record<ErrorCode, number> = {
  unauthorized: 401,
  not_found: 404,
  invalid_request: 400,
  conflict: 409,
  unsupported: 501,
  internal: 500,
  token_revoked: 401,
  rate_limited: 429,
  machine_offline: 503,
};

export class FardeskError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "FardeskError";
    this.code = code;
  }
}
