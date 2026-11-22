// Why a peer request failed: a sentence for a person who is not a specialist, and the technical detail for support.
export type Failure = { problem: string; detail: string };

export const REFUSED_TOKEN: Failure = {
  problem: "This computer does not accept the hub any more: it has to be linked again.",
  detail: "refused the hub's token (HTTP 401)",
};
export const NOT_LINKED: Failure = {
  problem: "This computer is not linked to the hub yet.",
  detail: "not linked: no token for it in coordinator.peerTokens",
};
export const SERVICE_NOT_RUNNING = "The Fardesk service on this computer is not running.";
export const NOT_REACHABLE = "This computer is not reachable over Tailscale (it may be asleep, offline, or Tailscale is off there).";
export const NO_ANSWER_IN_TIME = "This computer did not answer in time (it may be asleep, or Tailscale is off there).";
export const SLOW_ANSWER = "This computer is slow to answer, still trying.";
export const UNREADABLE_MACHINE: Failure = {
  problem: "The Fardesk service on this computer is a different version: the hub cannot read it.",
  detail: "sent a machine description the hub cannot read",
};

export const answeredWithError = (status: number): Failure => ({
  problem: "The Fardesk service on this computer answered with an error.",
  detail: `answered HTTP ${status}`,
});

function causeCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = typeof cause === "object" && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === "string" ? code : null;
}

export function describeFailure(error: unknown, timeoutMs: number): Failure {
  if (error instanceof Error && error.name === "TimeoutError") return { problem: NO_ANSWER_IN_TIME, detail: `no answer within ${timeoutMs / 1000} s` };
  const code = causeCode(error);
  if (code === "ECONNREFUSED") return { problem: SERVICE_NOT_RUNNING, detail: "connection refused (ECONNREFUSED)" };
  if (code !== null) return { problem: NOT_REACHABLE, detail: `cannot connect (${code})` };
  return { problem: NOT_REACHABLE, detail: error instanceof Error ? error.message : "request failed" };
}
