// A real local HTTP/2 server that plays APNs for tests (TLS with the committed test-only certificate).
import { readFileSync } from "node:fs";
import { createSecureServer } from "node:http2";
import type { Http2SecureServer, IncomingHttpHeaders, ServerHttp2Stream } from "node:http2";
import type { AddressInfo } from "node:net";
import { createApnsClient } from "../../src/push/apns.js";
import type { ApnsClient } from "../../src/push/apns.js";
import { fixturePath } from "./env.js";

export const APNS_TEST_CERT = readFileSync(fixturePath("apns", "localhost-test-only.crt.pem"), "utf8");
const APNS_TEST_KEY = readFileSync(fixturePath("apns", "localhost-test-only.key.pem"), "utf8");

export type Scripted = { status: number; body: string; closeSession?: boolean };
export type Recorded = { path: string; headers: IncomingHttpHeaders; body: string };
export type ApnsTestServer = {
  host: string;
  requests: Recorded[];
  sessions: number;
  closed: number;
  script: Scripted[];
  stop(): Promise<void>;
};

// A real APNs client pointed at the local test server (both environments).
export function createTestApnsClient(server: ApnsTestServer): ApnsClient {
  return createApnsClient({
    tokenSource: { token: (): string => "jwt" },
    topic: "com.example.fardesk",
    hosts: { sandbox: server.host, production: server.host },
    ca: APNS_TEST_CERT,
  });
}

export async function startApnsServer(): Promise<ApnsTestServer> {
  const server: Http2SecureServer = createSecureServer({ cert: APNS_TEST_CERT, key: APNS_TEST_KEY });
  const state = { requests: [] as Recorded[], sessions: 0, closed: 0, script: [] as Scripted[] };
  server.on("session", (session) => {
    state.sessions += 1;
    session.on("close", () => {
      state.closed += 1;
    });
  });
  server.on("stream", (stream: ServerHttp2Stream, headers: IncomingHttpHeaders) => {
    let body = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      body += chunk;
    });
    stream.on("end", () => {
      state.requests.push({ path: String(headers[":path"]), headers, body });
      const scripted = state.script.shift() ?? { status: 200, body: "" };
      stream.respond({ ":status": scripted.status });
      stream.end(scripted.body);
      if (scripted.closeSession === true) stream.session?.close();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const stop = async (): Promise<void> => {
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  };
  return Object.assign(state, { host: `https://localhost:${port}`, stop });
}
