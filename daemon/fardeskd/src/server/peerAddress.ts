// The peer address of a connection, read once when the connection opens (#107): Node reads `remoteAddress` lazily and
// answers undefined after the client has closed or reset, so a request that was sent and closed at once lost its address.
import type { Server } from "node:http";
import type { Socket } from "node:net";

export const UNKNOWN_ADDRESS = "unknown";

const known = new WeakMap<Socket, string>();

/** Remembers the address of every connection the server accepts, at the moment it is accepted. */
export function rememberPeerAddresses(server: Server): void {
  server.on("connection", (socket: Socket) => {
    if (socket.remoteAddress !== undefined) known.set(socket, socket.remoteAddress);
  });
}

/** The address cached at connect time, else the live one; "unknown" when neither exists (the caller is then refused). */
export function peerAddressOf(socket: Socket): string {
  return known.get(socket) ?? socket.remoteAddress ?? UNKNOWN_ADDRESS;
}
