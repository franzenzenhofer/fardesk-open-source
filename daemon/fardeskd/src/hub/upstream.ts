// One upstream WebSocket to a peer's /v1/stream, reconnecting with backoff (1 s doubling to 15 s).
import { WebSocket } from "ws";

export const RECONNECT_FIRST_MS = 1000;
export const RECONNECT_MAX_MS = 15_000;
const STREAM_PATH = "/v1/stream";

export type UpstreamOptions = {
  baseUrl: string;
  token: string;
  /** Raw text of every message the peer sends. */
  onMessage(raw: string): void;
  /** True once the socket is open, false when it closed. */
  onLive(live: boolean): void;
};

export type Upstream = { close(): void };

const streamUrl = (baseUrl: string): string => `${baseUrl.replace(/\/+$/, "").replace(/^http/, "ws")}${STREAM_PATH}`;

function wire(ws: WebSocket, options: UpstreamOptions, onOpen: () => void, onClose: () => void): void {
  ws.on("open", () => {
    onOpen();
    options.onLive(true);
  });
  ws.on("message", (data: Buffer) => { options.onMessage(data.toString("utf8")); });
  ws.on("unexpected-response", (_request, response) => {
    response.resume();
    ws.terminate();
  });
  ws.on("error", () => undefined);
  ws.once("close", () => {
    options.onLive(false);
    onClose();
  });
}

export function openUpstream(options: UpstreamOptions): Upstream {
  let socket: WebSocket | null = null;
  let timer: NodeJS.Timeout | null = null;
  let delay = RECONNECT_FIRST_MS;
  let closed = false;

  function connect(): void {
    socket = new WebSocket(streamUrl(options.baseUrl), { headers: { authorization: `Bearer ${options.token}` } });
    wire(socket, options, () => { delay = RECONNECT_FIRST_MS; }, () => {
      if (closed) return;
      timer = setTimeout(connect, delay);
      delay = Math.min(delay * 2, RECONNECT_MAX_MS);
    });
  }

  connect();
  return {
    close(): void {
      closed = true;
      if (timer !== null) clearTimeout(timer);
      socket?.terminate();
    },
  };
}
