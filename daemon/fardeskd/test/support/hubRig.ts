// The hub config every hub test starts from: one linked peer, one that never answers, one without a token.
import { TEST_TOKEN } from "./daemon.js";
import { freePort } from "./env.js";

export async function hubConfig(peerUrl: string): Promise<Record<string, unknown>> {
  const dead = await freePort();
  return {
    name: "hub-box",
    hub: { enabled: true, probeMs: 200 },
    peers: [{ name: "Peer A", url: peerUrl }, { name: "dead", url: `http://127.0.0.1:${dead}` }, { name: "unlinked", url: peerUrl }],
    coordinator: { peerTokens: { "Peer A": TEST_TOKEN, dead: TEST_TOKEN } },
  };
}
