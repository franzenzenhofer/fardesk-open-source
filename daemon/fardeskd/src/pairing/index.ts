// What the phone needs to pair with this daemon: name, URL and a one-time code as a fardesk:// link and a QR code.
import QRCode from "qrcode";
import type { Config } from "../config/config.js";
import { CONTRACT_VERSION } from "../contract/schema.js";
import type { PairingPayload } from "../contract/schema.js";

const LINK_PREFIX = "fardesk://pair?d=";

/** The base URL clients use to reach this daemon on `address`. */
export function daemonUrl(config: Pick<Config, "bind">, address: string): string {
  const host = address.includes(":") ? `[${address}]` : address;
  return `http://${host}:${config.bind.port}`;
}

export function buildPairingPayload(config: Pick<Config, "name" | "bind" | "hub">, address: string, code: string): PairingPayload {
  return { v: CONTRACT_VERSION, name: config.name, url: daemonUrl(config, address), code, hub: config.hub.enabled };
}

export function pairingLink(payload: PairingPayload): string {
  return `${LINK_PREFIX}${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

export async function renderQr(link: string): Promise<string> {
  return QRCode.toString(link, { type: "terminal", small: true });
}
