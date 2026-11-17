// The APNs client for the daemon config (null when push is not configured).
import { readFileSync } from "node:fs";
import type { Config } from "../config/config.js";
import { APNS_HOSTS, createApnsClient } from "../push/apns.js";
import type { ApnsClient } from "../push/apns.js";
import { createApnsTokenSource } from "../push/apnsJwt.js";

export function apnsFromConfig(config: Config, now: () => number): ApnsClient | null {
  if (config.apns === null) return null;
  const { keyPath, keyId, teamId, topic } = config.apns;
  const tokenSource = createApnsTokenSource({ keyPem: readFileSync(keyPath, "utf8"), keyId, teamId, now });
  return createApnsClient({ tokenSource, topic, hosts: APNS_HOSTS });
}
