import { connect } from "node:http2";
import type { ClientHttp2Session, ClientHttp2Stream } from "node:http2";
import { z } from "zod";
import type { ApnsTokenSource } from "./apnsJwt.js";

export const APNS_HOSTS = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
} as const;

const HTTP_OK = 200;
const ALERT_PRIORITY = "10";
const BACKGROUND_PRIORITY = "5";
const HTTP_GONE = 410;
const UNPARSEABLE_REASON = "UnparseableResponse";
const DEAD_TOKEN_REASONS: readonly string[] = ["BadDeviceToken", "Unregistered"];
const TIME_SENSITIVE_CATEGORIES: readonly string[] = ["PERMISSION", "QUESTION"];

export type ApnsEnvironment = keyof typeof APNS_HOSTS;
export type ApnsHosts = Record<ApnsEnvironment, string>;
export type ApnsCategory = "PERMISSION" | "QUESTION" | "DONE" | "ENDED";

export type ApnsNotification = {
  title: string;
  body: string;
  category: ApnsCategory;
  threadId: string;
  data: Record<string, string>;
  collapseId?: string;
};

export type ApnsClientOptions = {
  tokenSource: ApnsTokenSource;
  topic: string;
  hosts: ApnsHosts;
  ca?: string;
};

export type ApnsClient = {
  send(deviceToken: string, environment: ApnsEnvironment, notification: ApnsNotification): Promise<void>;
  /** Silent push (`content-available: 1`) carrying only the given string fields, e.g. the wipe command. */
  sendBackground(deviceToken: string, environment: ApnsEnvironment, data: Record<string, string>): Promise<void>;
  close(): void;
};

export class ApnsError extends Error {
  readonly status: number;
  readonly reason: string;

  constructor(status: number, reason: string) {
    super(`APNs rejected the push: ${status} ${reason}`);
    this.name = "ApnsError";
    this.status = status;
    this.reason = reason;
  }
}

export function isDeadTokenError(error: unknown): boolean {
  return error instanceof ApnsError && (error.status === HTTP_GONE || DEAD_TOKEN_REASONS.includes(error.reason));
}

const reasonSchema = z.object({ reason: z.string() });

function parseReason(body: string): string {
  try {
    const parsed = reasonSchema.safeParse(JSON.parse(body));
    return parsed.success ? parsed.data.reason : UNPARSEABLE_REASON;
  } catch {
    return UNPARSEABLE_REASON;
  }
}

export function buildPayload(notification: ApnsNotification): string {
  const interruption = TIME_SENSITIVE_CATEGORIES.includes(notification.category) ? "time-sensitive" : "active";
  return JSON.stringify({
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: "default",
      category: notification.category,
      "thread-id": notification.threadId,
      "interruption-level": interruption,
    },
    ...notification.data,
  });
}

function createSessionPool(ca: string | undefined): { sessionFor(host: string): ClientHttp2Session; closeAll(): void } {
  const sessions = new Map<string, ClientHttp2Session>();
  return {
    sessionFor(host): ClientHttp2Session {
      const existing = sessions.get(host);
      if (existing !== undefined) return existing;
      const session = connect(host, ca === undefined ? {} : { ca });
      const forget = (): void => {
        if (sessions.get(host) === session) sessions.delete(host);
      };
      session.on("close", forget);
      session.on("error", forget);
      sessions.set(host, session);
      return session;
    },
    closeAll(): void {
      for (const session of sessions.values()) session.close();
      sessions.clear();
    },
  };
}

type Delivery = { pushType: "alert" | "background"; priority: string; collapseId?: string | undefined; payload: string };

function buildHeaders(options: ApnsClientOptions, deviceToken: string, delivery: Delivery): Record<string, string> {
  return {
    ":method": "POST",
    ":path": `/3/device/${deviceToken}`,
    authorization: `bearer ${options.tokenSource.token()}`,
    "apns-topic": options.topic,
    "apns-push-type": delivery.pushType,
    "apns-priority": delivery.priority,
    "content-type": "application/json",
    ...(delivery.collapseId === undefined ? {} : { "apns-collapse-id": delivery.collapseId }),
  };
}

export function buildBackgroundPayload(data: Record<string, string>): string {
  return JSON.stringify({ aps: { "content-available": 1 }, ...data });
}

async function exchange(request: ClientHttp2Stream, payload: string): Promise<{ status: number; body: string }> {
  let status = 0;
  let body = "";
  request.setEncoding("utf8");
  request.on("response", (headers) => {
    status = Number(headers[":status"]);
  });
  request.on("data", (chunk: string) => {
    body += chunk;
  });
  const finished = new Promise<void>((resolve, reject) => {
    request.on("error", reject);
    request.on("end", resolve);
  });
  request.end(payload);
  await finished;
  return { status, body };
}

export function createApnsClient(options: ApnsClientOptions): ApnsClient {
  const pool = createSessionPool(options.ca);
  const deliver = async (deviceToken: string, environment: ApnsEnvironment, delivery: Delivery): Promise<void> => {
    const session = pool.sessionFor(options.hosts[environment]);
    const request = session.request(buildHeaders(options, deviceToken, delivery));
    const { status, body } = await exchange(request, delivery.payload);
    if (status !== HTTP_OK) throw new ApnsError(status, parseReason(body));
  };
  return {
    send: async (deviceToken, environment, notification): Promise<void> =>
      deliver(deviceToken, environment, {
        pushType: "alert",
        priority: ALERT_PRIORITY,
        collapseId: notification.collapseId,
        payload: buildPayload(notification),
      }),
    sendBackground: async (deviceToken, environment, data): Promise<void> =>
      deliver(deviceToken, environment, { pushType: "background", priority: BACKGROUND_PRIORITY, payload: buildBackgroundPayload(data) }),
    close(): void {
      pool.closeAll();
    },
  };
}
