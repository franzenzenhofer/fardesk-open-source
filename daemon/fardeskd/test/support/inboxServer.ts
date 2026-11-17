// A real Unix-socket "session inbox" like Claude Code's: reads one JSON line per message and, when
// delivering, appends the message to the session transcript (what Claude Code does with a peer message).
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { join } from "node:path";
import { makeTempDir } from "./env.js";

export type InboxServer = { socketPath: string; received: string[]; setTranscript(path: string): void; close(): Promise<void> };

export async function startInbox(deliver: boolean, transcriptPath: string | null): Promise<InboxServer> {
  const socketPath = join(makeTempDir("fdi-"), "inbox.sock");
  const received: string[] = [];
  let target = transcriptPath;
  const server: Server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString("utf8");
      for (const line of buffered.split("\n").slice(0, -1)) {
        const text = (JSON.parse(line) as { message: { content: string } }).message.content;
        received.push(text);
        if (deliver && target !== null) appendPeerMessage(target, text);
      }
      buffered = buffered.slice(buffered.lastIndexOf("\n") + 1);
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    socketPath,
    received,
    setTranscript: (path): void => {
      target = path;
    },
    close: async (): Promise<void> => {
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    },
  };
}

function appendPeerMessage(path: string, text: string): void {
  const line = {
    type: "user",
    uuid: `peer-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    isSidechain: false,
    cwd: "/work/project",
    isMeta: true,
    origin: { kind: "peer" },
    message: { role: "user", content: `Another Claude session sent a message:\n${text}` },
  };
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}

