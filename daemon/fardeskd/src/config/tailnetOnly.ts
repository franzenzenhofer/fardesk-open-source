// Tailscale only, no other way (ticket #92). The daemon listens on its tailnet address and talks to peers on
// tailnet addresses; a real config can say nothing else. The test sandbox (FARDESK_TEST_SANDBOX) is the one
// seam that lets a test daemon sit on loopback.
import { isIPv4 } from "node:net";
import { inTestSandbox } from "../core/sandbox.js";
import { isLoopbackAddress, isTailnetAddress } from "./tailnetAddress.js";

export const TAILSCALE_KEYWORD = "tailscale";

const GUIDANCE = "Fardesk is reachable over Tailscale only, no other way";

/** Why `bind.address` is refused, or null when it is fine. */
export function bindAddressProblem(address: string): string | null {
  if (address === TAILSCALE_KEYWORD) return null;
  if (inTestSandbox() && isLoopbackAddress(address)) return null;
  return `bind.address ${JSON.stringify(address)} is not allowed: ${GUIDANCE}. Use "tailscale" (the daemon then listens on its tailnet address only).`;
}

/** A source address that may be a node of the tailnet: 100.64.0.0/10. Inside the test sandbox any IPv4 address (the test computer's own network address) stands in for one, so tests reach the daemon from a source other than loopback. */
export const isNodeAddress = (address: string): boolean => isTailnetAddress(address) || (inTestSandbox() && isIPv4(address));

/** Why the peer address `url` is refused, or null when it is http on a tailnet address (Tailscale encrypts, Fardesk adds no TLS). */
export function peerAddressProblem(name: string, url: string): string | null {
  const { hostname, protocol } = new URL(url);
  if (protocol !== "http:") return `peer ${JSON.stringify(name)} at ${JSON.stringify(url)} must use http: Fardesk 4 uses Tailscale for encryption, there is no https.`;
  if (isTailnetAddress(hostname)) return null;
  if (inTestSandbox() && isLoopbackAddress(hostname)) return null;
  return `peer ${JSON.stringify(name)} at ${JSON.stringify(url)} is not a tailnet address (100.64.0.0/10): ${GUIDANCE}.`;
}
