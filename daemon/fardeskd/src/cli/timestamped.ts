// The daemon's own log lines on stdout (waiting for Tailscale, listening, address changes) carry an ISO UTC time.
export type LineWriter = (line: string) => void;

export function timestamped(write: LineWriter, now: () => Date): LineWriter {
  return (line) => {
    write(`${now().toISOString()} ${line}`);
  };
}
