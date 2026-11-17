import { connect } from "node:net";
import { FardeskError } from "../core/errors.js";
import { assertSandboxPath } from "../core/sandbox.js";

export const INBOX_FROM_LABEL = "fardesk";

export type PostToInboxOptions = {
  socketPath: string;
  text: string;
  from: string;
};

export function encodeInboxLine(text: string, from: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text }, from })}\n`;
}

// The peer never replies (Spike A): resolve once the line is flushed, then end the connection.
export async function postToInbox(options: PostToInboxOptions): Promise<void> {
  assertSandboxPath("inbox socket", options.socketPath);
  const line = encodeInboxLine(options.text, options.from);
  return new Promise((resolve, reject) => {
    const socket = connect(options.socketPath);
    socket.once("error", (error) => {
      socket.destroy();
      reject(new FardeskError("unsupported", `session inbox is not reachable: ${error.message}`));
    });
    socket.once("connect", () => {
      socket.end(line, () => {
        resolve();
      });
    });
  });
}
