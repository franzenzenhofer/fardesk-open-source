// Every tmux server of this user: the default one plus each socket in `<TMUX_TMPDIR or /tmp>/tmux-<uid>/` (tmux -L and -S servers).
import { readdirSync, statSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";

const DEFAULT_TMUX_DIR = "/tmp";

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

function entriesOf(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Absolute paths of the tmux sockets that exist. The uid and the environment are parameters so callers (and tests) stay explicit. */
export function listTmuxSockets(env: NodeJS.ProcessEnv, uid: number): string[] {
  const roots = new Set([env["TMUX_TMPDIR"] ?? DEFAULT_TMUX_DIR, DEFAULT_TMUX_DIR]);
  const sockets: string[] = [];
  for (const root of roots) {
    const dir = join(root, `tmux-${uid}`);
    for (const name of entriesOf(dir)) {
      const path = join(dir, name);
      if (isSocket(path)) sockets.push(path);
    }
  }
  return sockets;
}

const PROBE_TIMEOUT_MS = 300;

/** True when a tmux server answers on the socket; stale socket files of dead servers are refused at once and cost no process. */
export async function socketAccepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect(path);
    const finish = (accepted: boolean): void => {
      socket.destroy();
      resolve(accepted);
    };
    socket.setTimeout(PROBE_TIMEOUT_MS, () => { finish(false); });
    socket.once("connect", () => { finish(true); });
    socket.once("error", () => { finish(false); });
  });
}
