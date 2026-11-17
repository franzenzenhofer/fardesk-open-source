// WS /m/<machine>/v1/stream: this machine's own stream, or a peer's cached hello plus its live upstream events.
import type { WebSocket } from "ws";
import { MAX_BUFFERED_BYTES } from "../server/stream.js";
import type { StreamRouter } from "../server/stream.js";
import { decodeMachine, knownPeer, requireOnline } from "./guard.js";
import type { Hub } from "./hub.js";
import type { PeerMonitor } from "./monitor.js";

const STREAM_ROUTE = /^\/m\/([^/]+)\/v1\/stream$/;

function relay(peer: PeerMonitor, socket: WebSocket): void {
  const send = (text: string): void => {
    if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      socket.terminate();
      return;
    }
    socket.send(text);
  };
  const machine = peer.cache.machine();
  if (machine !== null) send(JSON.stringify({ type: "hello", machine, sessions: peer.cache.sessions() }));
  const unsubscribe = peer.subscribe(send);
  socket.once("close", unsubscribe);
}

export function createStreamRouter(hub: Hub): StreamRouter {
  return (pathname) => {
    const raw = STREAM_ROUTE.exec(pathname)?.[1];
    if (raw === undefined) return null;
    const name = decodeMachine(raw);
    if (name === hub.name) return "local";
    const peer = knownPeer(hub, name);
    requireOnline(peer);
    return (socket) => { relay(peer, socket); };
  };
}
