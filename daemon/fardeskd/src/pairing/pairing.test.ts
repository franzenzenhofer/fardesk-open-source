import { describe, expect, it } from "vitest";
import { pairingPayloadSchema } from "../contract/schema.js";
import { buildPairingPayload, daemonUrl, pairingLink, renderQr } from "./index.js";

const CODE = "c".repeat(43);
const base: Parameters<typeof buildPairingPayload>[0] = { name: "mac-mini", bind: { address: "tailscale", port: 4780 }, hub: { enabled: false, probeMs: 5000 } };

describe("pairing", () => {
  it("builds a contract payload with an http URL and no certificate pin", () => {
    const payload = buildPairingPayload(base, "100.64.0.7", CODE);
    expect(pairingPayloadSchema.parse(payload)).toEqual({ v: 4, name: "mac-mini", url: "http://100.64.0.7:4780", code: CODE, hub: false });
    expect(payload).not.toHaveProperty("pin");
  });

  it("refuses an https URL and drops a pin: Fardesk has no own TLS", () => {
    const payload = buildPairingPayload(base, "100.64.0.7", CODE);
    expect(pairingPayloadSchema.safeParse({ ...payload, url: "https://100.64.0.7:4780" }).success).toBe(false);
    const pinned = pairingPayloadSchema.parse({ ...payload, pin: `sha256/${"A".repeat(43)}=` });
    expect(pinned).not.toHaveProperty("pin");
  });

  it("tells the app that a hub machine is a hub", () => {
    expect(buildPairingPayload({ ...base, hub: { enabled: true, probeMs: 5000 } }, "100.64.0.7", CODE).hub).toBe(true);
  });

  it("brackets IPv6 addresses", () => {
    expect(daemonUrl(base, "fd7a::1")).toBe("http://[fd7a::1]:4780");
  });

  it("carries a code and no master token or 64-hex string", () => {
    const link = pairingLink(buildPairingPayload(base, "100.64.0.7", CODE));
    const decoded = Buffer.from(link.slice("fardesk://pair?d=".length), "base64url").toString("utf8");
    expect(JSON.parse(decoded)).not.toHaveProperty("token");
    expect(link + decoded).not.toMatch(/[0-9a-f]{64}/);
  });

  it("encodes the payload as base64url JSON in a fardesk:// link", () => {
    const payload = buildPairingPayload(base, "100.64.0.7", CODE);
    const link = pairingLink(payload);
    expect(link.startsWith("fardesk://pair?d=")).toBe(true);
    const decoded = Buffer.from(link.slice("fardesk://pair?d=".length), "base64url").toString("utf8");
    expect(JSON.parse(decoded)).toEqual(payload);
  });

  it("renders a terminal QR code", async () => {
    const qr = await renderQr(pairingLink(buildPairingPayload(base, "100.64.0.7", CODE)));
    expect(qr.split("\n").length).toBeGreaterThan(10);
    expect(qr).toMatch(/[▀-▟]/);
  });
});
