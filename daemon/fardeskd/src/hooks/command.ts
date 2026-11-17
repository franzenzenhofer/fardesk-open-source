// The hook command Claude Code runs (through `sh -c`) and the settings fragment that registers it.
// Spike C: curl over the Unix socket, `-f` so an HTTP error prints nothing, `|| true` so the hook
// always exits 0 and Claude Code falls back to its normal dialog when the daemon is not there.

export const HOOK_MARKER = "http://fardesk/hook";

const PERMISSION_CURL_SLACK_SECONDS = 5;
const PERMISSION_HOOK_SLACK_SECONDS = 10;
const ASYNC_CURL_SECONDS = 0.25;

export const PERMISSION_EVENT = "PermissionRequest";
export const ASYNC_EVENTS = ["Stop", "SessionStart", "SessionEnd"] as const;

export type HookDefinition = {
  type: "command";
  command: string;
  timeout?: number;
  async?: true;
};

export type HookGroup = { hooks: HookDefinition[] };

export type HookEntries = Record<string, HookGroup[]>;

export type HookEntryOptions = { socketPath: string; permissionTimeoutSeconds: number };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function buildHookCommand(socketPath: string, maxSeconds: number): string {
  return (
    `curl -sf -m ${maxSeconds} --unix-socket ${shellQuote(socketPath)} ` +
    `-H 'Content-Type: application/json' --data-binary @- ${HOOK_MARKER} 2>/dev/null || true`
  );
}

export function buildHookEntries(options: HookEntryOptions): HookEntries {
  const { socketPath, permissionTimeoutSeconds } = options;
  const entries: HookEntries = {
    [PERMISSION_EVENT]: [
      {
        hooks: [
          {
            type: "command",
            command: buildHookCommand(socketPath, permissionTimeoutSeconds + PERMISSION_CURL_SLACK_SECONDS),
            timeout: permissionTimeoutSeconds + PERMISSION_HOOK_SLACK_SECONDS,
          },
        ],
      },
    ],
  };
  for (const event of ASYNC_EVENTS) {
    entries[event] = [
      { hooks: [{ type: "command", command: buildHookCommand(socketPath, ASYNC_CURL_SECONDS), async: true }] },
    ];
  }
  return entries;
}
