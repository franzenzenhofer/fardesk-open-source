// Requests to one peer over plain HTTP on the tailnet: the authorised call and the GET /v1/machine health probe.
import { ZodError } from "zod";
import { machineSchema } from "../contract/schema.js";
import type { Machine } from "../contract/schema.js";
import { FardeskError } from "../core/errors.js";
import { answeredWithError, describeFailure, REFUSED_TOKEN, UNREADABLE_MACHINE } from "./failure.js";
import type { Failure } from "./failure.js";

export const PROBE_TIMEOUT_MS = 5000;

export type PeerLink = { name: string; baseUrl: string; token: string };
export type PeerCall = { method: string; path: string; headers?: Record<string, string>; body?: ArrayBuffer | Uint8Array<ArrayBuffer> | undefined; timeoutMs: number };
/** `timedOut`: the peer did not answer in time (it may only be busy), unlike a refused connection. */
export type ProbeResult = { online: boolean; timedOut: boolean; latencyMs: number | null; problem: string | null; detail: string | null; machine: Machine | null };

async function send(link: PeerLink, call: PeerCall): Promise<Response> {
  const headers = { ...call.headers, authorization: `Bearer ${link.token}` };
  const init: RequestInit = { redirect: "error", method: call.method, headers, signal: AbortSignal.timeout(call.timeoutMs), ...(call.body === undefined ? {} : { body: call.body }) };
  return fetch(`${link.baseUrl}${call.path}`, init);
}

/** One request to the peer; a peer that does not answer becomes `machine_offline`. */
export async function callPeer(link: PeerLink, call: PeerCall): Promise<Response> {
  try {
    return await send(link, call);
  } catch (error) {
    throw new FardeskError("machine_offline", `${link.name} did not answer: ${describeFailure(error, call.timeoutMs).problem} (${describeFailure(error, call.timeoutMs).detail})`);
  }
}

const down = ({ problem, detail }: Failure): ProbeResult => ({ online: false, timedOut: false, latencyMs: null, problem, detail, machine: null });
const slow = (failure: Failure): ProbeResult => ({ ...down(failure), timedOut: true });
const isTimeout = (error: unknown): boolean => error instanceof Error && error.name === "TimeoutError";

export async function probePeer(link: PeerLink): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const response = await send(link, { method: "GET", path: "/v1/machine", timeoutMs: PROBE_TIMEOUT_MS });
    if (response.status === 401) return down(REFUSED_TOKEN);
    if (!response.ok) return down(answeredWithError(response.status));
    const machine = machineSchema.strip().parse(await response.json());
    return { online: true, timedOut: false, latencyMs: Date.now() - started, problem: null, detail: null, machine };
  } catch (error) {
    if (error instanceof ZodError) return down(UNREADABLE_MACHINE);
    const failure = describeFailure(error, PROBE_TIMEOUT_MS);
    return isTimeout(error) ? slow(failure) : down(failure);
  }
}
