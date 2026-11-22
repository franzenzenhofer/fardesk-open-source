// Starts the plain HTTP listener on exactly the given address (the tailnet address) and attaches the WebSocket stream.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { App } from "./context.js";
import { rememberPeerAddresses } from "./peerAddress.js";
import type { Bus } from "../core/bus.js";
import type { Services } from "../service/types.js";
import { MAX_BUFFERED_BYTES, attachStream } from "./stream.js";
import type { StreamRouter } from "./stream.js";

export type ListenOptions = {
  address: string;
  port: number;
  pingMs: number;
  maxBufferedBytes?: number;
  /** Extra stream paths (the hub's /m/<machine>/v1/stream). */
  streamRouter?: StreamRouter;
};

export type RunningServer = { server: Server; address: string; port: number; close(): Promise<void> };

async function listen(app: App, options: ListenOptions): Promise<Server> {
  const { address, port } = options;
  return new Promise((resolve, reject) => {
    // Plain HTTP on exactly one address, the tailnet address: Tailscale (WireGuard) encrypts and authenticates the link.
    const server = serve({ fetch: app.fetch, port, hostname: address }, () => { resolve(server); }) as Server;
    rememberPeerAddresses(server);
    server.once("error", reject);
  });
}

export async function startServer(app: App, options: ListenOptions, bus: Bus, services: Services): Promise<RunningServer> {
  const server = await listen(app, options);
  const stream = attachStream(server, bus, services, {
    pingMs: options.pingMs,
    maxBufferedBytes: options.maxBufferedBytes ?? MAX_BUFFERED_BYTES,
    router: options.streamRouter,
  });
  const bound = server.address() as AddressInfo;
  return {
    server,
    address: bound.address,
    port: bound.port,
    close: async (): Promise<void> => {
      stream.close();
      const closed = new Promise<void>((resolve) => server.close(() => { resolve(); }));
      server.closeAllConnections();
      await closed;
    },
  };
}
