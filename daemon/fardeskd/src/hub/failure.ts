// Plain-words reasons why a peer request failed.
export const REFUSED_TOKEN = "refused the hub's token";

function causeCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}

export function describeFailure(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === "TimeoutError") return `no answer within ${timeoutMs / 1000} s`;
  const code = causeCode(error);
  if (code === "ECONNREFUSED") return "connection refused (the daemon is not running there)";
  if (code !== null) return `cannot connect (${code})`;
  return error instanceof Error ? error.message : "request failed";
}
