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
import { peerAddressOf } from "./peerAddress.js";

export const STREAM_PATH = "/v1/stream";
export const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
const CLOSE_POLICY_VIOLATION = 1008;
const REVOKED_REASON = "token_revoked";
const NODE_CHECK_FAILED_REASON = "node_check_failed";
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

async function upgradeTarget(request: IncomingMessage, services: Services, options: StreamOptions): Promise<{ deviceId: string; target: "local" | StreamServe }> {
  const deviceId = await requireCaller(services.auth, request.headers.authorization, peerAddressOf(request.socket));
  const pathname = new URL(request.url as string, "http://fardesk").pathname;
  const target = pathname === STREAM_PATH ? "local" : options.router?.(pathname);
  if (target === null || target === undefined) throw new FardeskError("not_found", "no such stream path");
  return { deviceId, target };
}

/**
 * The token of an open stream stays valid only while Tailscale still shows the connection coming from the node the
 * token belongs to: asked again every `nodeCheckMs` (the whois cache lifetime), a mismatch or a silent Tailscale closes
 * the stream with 1008 and the code of the refusal.
 */
function watchNode(ws: WebSocket, request: IncomingMessage, services: Services): void {
  const ip = peerAddressOf(request.socket);
  const timer = setInterval(() => {
    requireCaller(services.auth, request.headers.authorization, ip, true).catch((error: unknown) => {
      ws.close(CLOSE_POLICY_VIOLATION, error instanceof FardeskError ? error.code : NODE_CHECK_FAILED_REASON);
    });
  }, services.auth.nodeCheckMs);
  ws.once("close", () => { clearInterval(timer); });
}

export function attachStream(server: Server, bus: Bus, services: Services, options: StreamOptions): Stream {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const owners = new Map<WebSocket, string>();
  const serveLocal: StreamServe = (socket) => { serve(socket, bus, services, options); };
  const stopListening = services.auth.onRevoked((deviceIds) => {
    for (const [socket, deviceId] of owners) if (deviceIds.includes(deviceId)) socket.close(CLOSE_POLICY_VIOLATION, REVOKED_REASON);
  });
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    // After "upgrade" the HTTP server no longer watches this socket: a client that hangs up mid-upgrade (a phone
    // going to the background) would raise an unhandled ECONNRESET and end the whole daemon.
    socket.on("error", () => { socket.destroy(); });
    upgradeTarget(request, services, options).then(({ deviceId, target }) => {
      wss.handleUpgrade(request, socket, head, (ws) => {
        owners.set(ws, deviceId);
        ws.once("close", () => { owners.delete(ws); });
        watchNode(ws, request, services);
        (target === "local" ? serveLocal : target)(ws);
      });
    }, (error: unknown) => {
      if (!(error instanceof FardeskError)) throw error;
      rejectUpgrade(socket, error);
    });
  });
  return {
    close(): void {
      stopListening();
      for (const client of wss.clients) client.terminate();
      wss.close();
    },
  };
}
