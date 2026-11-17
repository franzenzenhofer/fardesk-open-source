// Starts the HTTP(S) listener on exactly the given address and attaches the WebSocket stream.
import { readFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import type { App } from "./context.js";
import type { Config } from "../config/config.js";
import type { Bus } from "../core/bus.js";
import type { Services } from "../service/types.js";
import { MAX_BUFFERED_BYTES, attachStream } from "./stream.js";
import type { StreamRouter } from "./stream.js";

export type ListenOptions = {
  address: string;
  port: number;
  tls: Config["tls"];

  pingMs: number;
  maxBufferedBytes?: number;
  /** Extra stream paths (the hub's /m/<machine>/v1/stream). */
  streamRouter?: StreamRouter;
};

export type RunningServer = { server: Server; address: string; port: number; close(): Promise<void> };

async function listen(app: App, options: ListenOptions): Promise<Server> {
  const { address, port, tls } = options;
  return new Promise((resolve, reject) => {
    const base = { fetch: app.fetch, port, hostname: address };
    const server = (
      tls === null
        ? serve(base, () => { resolve(server); })
        : serve(
            { ...base, createServer: createHttpsServer, serverOptions: { cert: readFileSync(tls.cert), key: readFileSync(tls.key) } },
            () => { resolve(server); },
          )
    ) as Server;
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
