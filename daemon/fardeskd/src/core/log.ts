export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, string | number | boolean | null>;
export type LogSink = (line: string) => void;

export type Logger = {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
};

export function stderrSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function createLogger(sink: LogSink, now: () => Date): Logger {
  const write = (level: LogLevel, msg: string, fields: LogFields = {}): void => {
    sink(JSON.stringify({ ts: now().toISOString(), level, msg, ...fields }));
  };
  return {
    info: (msg, fields): void => {
      write("info", msg, fields);
    },
    warn: (msg, fields): void => {
      write("warn", msg, fields);
    },
    error: (msg, fields): void => {
      write("error", msg, fields);
    },
  };
}
