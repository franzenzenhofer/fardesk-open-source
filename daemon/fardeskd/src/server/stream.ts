// WebSocket /v1/stream: hello, then every bus event, plus pings. Slow clients are dropped; revoked devices are cut off.
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import type { WebSocket } from "ws";
import type { SessionSummary, StreamEvent } from "../contract/schema.js";
import type { Bus } from "../core/bus.js";
import { FardeskError, HTTP_STATUS } from "../core/errors.js";
import type { Services } from "../service/types.js";
import { requireCaller } from "./auth.js";
import { errorBody } from "./errorBody.js";

export const STREAM_PATH = "/v1/stream";
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const CLOSE_POLICY_VIOLATION = 1008;
const REVOKED_REASON = "token_revoked";
const HTTP_STATUS_TEXT: Record<number, string> = { 401: "Unauthorized", 404: "Not Found", 429: "Too Many Requests", 503: "Service Unavailable" };

/** Serves one accepted socket. */
export type StreamServe = (socket: WebSocket) => void;
/** Maps an upgrade path to this machine's own stream ("local"), to another handler, or null when the path is not its own. May throw FardeskError. */
export type StreamRouter = (pathname: string) => "local" | StreamServe | null;
export type StreamOptions = { pingMs: number; maxBufferedBytes: number; router?: StreamRouter | undefined };
export type Stream = { close(): void };

function rejectUpgrade(socket: Duplex, error: FardeskError): void {
  const status = HTTP_STATUS[error.code];
  const body = JSON.stringify(errorBody(error.code, error.message));
  const head = `HTTP/1.1 ${status} ${HTTP_STATUS_TEXT[status] ?? "Error"}`;
  socket.end(`${head}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

/**
 * Which `session` events a client gets: only those of sessions its list shows (`services.sessions()`: live ones, the
 * newest ended ones), as the store also holds hundreds of hidden ended sessions. A session the client was told about
 * that then leaves the list still gets its last event (it ended), once, so the client does not keep it "working".
 */
function sessionFilter(services: Services, told: Set<string>): (session: SessionSummary) => boolean {
  return (session) => {
    if (session.status !== "ended") {
      told.add(session.id);
      return true;
    }
    if (services.sessions().some((listed) => listed.id === session.id)) {
      told.add(session.id);
      return true;
    }
    return told.delete(session.id);
  };
}

function serve(socket: WebSocket, bus: Bus, services: Services, options: StreamOptions): void {
  const send = (event: StreamEvent): void => {
    if (socket.bufferedAmount > options.maxBufferedBytes) {
      socket.terminate();
      return;
    }
    socket.send(JSON.stringify(event));
  };
  const sessions = services.sessions();
  const shows = sessionFilter(services, new Set(sessions.map((session) => session.id)));
  send({ type: "hello", machine: services.machine(), sessions });
  const unsubscribe = bus.subscribe((event) => {
    if (event.type !== "session" || shows(event.session)) send(event);
  });
  const pinger = setInterval(() => { send({ type: "ping", ts: new Date().toISOString() }); }, options.pingMs);
  socket.once("close", () => {
    clearInterval(pinger);
    unsubscribe();
  });
}

function upgradeTarget(request: IncomingMessage, services: Services, options: StreamOptions): { deviceId: string; target: "local" | StreamServe } {
  const deviceId = requireCaller(services.auth, request.headers.authorization, request.socket.remoteAddress ?? "unknown");
  const pathname = new URL(request.url as string, "http://fardesk").pathname;
  const target = pathname === STREAM_PATH ? "local" : options.router?.(pathname);
  if (target === null || target === undefined) throw new FardeskError("not_found", "no such stream path");
  return { deviceId, target };
}

export function attachStream(server: Server, bus: Bus, services: Services, options: StreamOptions): Stream {
  const wss = new WebSocketServer({ noServer: true });
  const owners = new Map<WebSocket, string>();
  const serveLocal: StreamServe = (socket) => { serve(socket, bus, services, options); };
  const stopListening = services.auth.onRevoked((deviceIds) => {
    for (const [socket, deviceId] of owners) if (deviceIds.includes(deviceId)) socket.close(CLOSE_POLICY_VIOLATION, REVOKED_REASON);
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // After "upgrade" the HTTP server no longer watches this socket: a client that hangs up mid-upgrade (a phone
    // going to the background) would raise an unhandled ECONNRESET and end the whole daemon.
    socket.on("error", () => { socket.destroy(); });
    try {
      const { deviceId, target } = upgradeTarget(request, services, options);
      wss.handleUpgrade(request, socket, head, (ws) => {
        owners.set(ws, deviceId);
        ws.once("close", () => { owners.delete(ws); });
        (target === "local" ? serveLocal : target)(ws);
      });
    } catch (error) {
      if (!(error instanceof FardeskError)) throw error;
      rejectUpgrade(socket, error);
    }
  });
  return {
    close(): void {
      stopListening();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
