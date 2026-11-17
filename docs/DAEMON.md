# fardeskd - internal design

Binding for everyone who writes daemon code. The wire contract is `src/contract/schema.ts`; this
file fixes the module boundaries so modules can be built in parallel and composed without glue code.

## Rules

- Each module exports plain functions or small factory functions (`createX(deps): X`). No classes
  with hidden state, no singletons, no module-level mutable state.
- Every dependency on the outside world (paths, clock, intervals, child processes, sockets) comes
  in through the factory's `deps` argument with real defaults built in `main.ts`. Tests pass real
  temp dirs, real sockets and short intervals. No mocks.
- Timers and watchers are owned by the object that created them and released by its `close()`.
- Errors: throw `FardeskError(code, message)` (`src/core/errors.ts`, `code` is the contract
  `ErrorCode`). The server maps it to the HTTP status. Never swallow an error.
- All data read from disk or the network is parsed with zod before use. Lenient where Claude Code
  owns the format (`z.looseObject`, unknown line types are skipped and counted), strict for our own.
- Logging: `src/core/log.ts`, one JSON line per event on stderr (`level`, `msg`, fields).

## Modules and their public surface

```ts
// src/core/errors.ts
class FardeskError extends Error { constructor(code: ErrorCode, message: string) }
const HTTP_STATUS: Record<ErrorCode, number>

// src/core/bus.ts - one typed fan-out for stream events
type Bus = { publish(event: StreamEvent): void; subscribe(fn: (e: StreamEvent) => void): () => void }
function createBus(): Bus

// src/config/config.ts
type Config = {            // zod: configSchema, strict
  name: string             // machine name shown in clients
  bind: { address: string | "tailscale"; port: number }   // "tailscale" = resolve with `tailscale ip -4`
  token: string            // bearer token, min 32 chars
  tls: { cert: string; key: string } | null
  claudeHomes: string[]    // default ["~/.claude"]
  claudeBinary: string     // default "claude" (resolved on PATH)
  stateDir: string         // default "~/.local/state/fardesk": hook socket, state file, logs
  models: string[]         // offered in New Session
  intervals: { registryPollMs: number; transcriptPollMs: number; pingMs: number }
  permissionTimeoutSeconds: number
  activityPageLimit: { default: number; max: number }
  detail: { maxOutputLines: number }
  summaryMaxChars: number
  notifications: NotificationType[]
  apns: { keyPath: string; keyId: string; teamId: string; topic: string } | null
  tmuxBinary: string
  coordinator: { peerTokens: Record<string, string>; model: string | null }   // see Coordinator
}
function loadConfig(path: string): Config            // throws on missing or invalid file
function writeInitialConfig(path: string, name: string): Config   // generates the token
function expandHome(p: string): string

// src/transcript/* - the ONE place that understands transcript lines
function parseLine(raw: string): TranscriptLine | null     // null = blank or unknown type (counted)
function mapActivities(lines: TranscriptLine[], opts: MapOptions): Activity[]   // pure, whole-session mapping
function buildDetail(lines: TranscriptLine[], activityId: string, opts): ActivityDetail  // throws not_found
function summarise(lines: TranscriptLine[], maxChars: number): TranscriptSummary
  // { title: string|null (ai-title or custom title), summary: string, cwd: string|null, model: string|null,
  //   permissionMode: string|null, startedAt: string|null, updatedAt: string|null, pendingToolUse: boolean,
  //   contextTokens: number|null, cacheExpiresAt: string|null }  (usage of the last main-chain assistant line, see "Cold sessions")
function createTailer(deps: { path: string; pollMs: number; onLines(lines: TranscriptLine[]): void }): { close(): void; lines(): TranscriptLine[] }

// src/sessions/*
type LiveProcess = { pid: number; sessionId: string; cwd: string; status: "busy"|"idle"|"waiting"|"shell"|string;
  name: string|null; kind: string; entrypoint: string; tmux: string|null; messagingSocketPath: string|null; startedAt: number; updatedAt: number }
function readClaudeRegistry(claudeHome: string): LiveProcess[]      // + isAlive(pid) check
function findTranscripts(claudeHome: string): TranscriptRef[]       // { sessionId, path, mtimeMs }
function createSessionStore(deps): SessionStore
type SessionStore = {
  list(): SessionSummary[]                  // ordered waiting, working, idle, ended; then newest first
  get(id: string): SessionRecord            // throws not_found; { summary, transcriptPath, process: LiveProcess|null, permissionMode }
  recentFolders(): RecentFolders
  setOverlay(id: string, overlay: Partial<SessionOverlay>): void   // owned flag, waitingFor, muted (from other modules)
  refresh(): void                           // one poll cycle; also runs on an interval
  close(): void
}                                           // publishes {type:"session"} on the bus when a summary changes

// src/hooks/*
function installHooks(settingsPath: string, hookCommand: HookCommands): InstallResult   // backup, merge, idempotent
function uninstallHooks(settingsPath: string): InstallResult
function createHookReceiver(deps: { socketPath: string; onEvent(e: HookEvent): Promise<HookReply> }): { close(): Promise<void> }

// src/permissions/broker.ts - shared by the hook path and the owned path
type PendingRequest = { requestId: string; sessionId: string; kind: "permission"|"question"; activity: Activity }
function createBroker(deps: { timeoutMs: number; bus: Bus; now(): Date }): Broker
type Broker = {
  ask(input: AskInput): Promise<BrokerAnswer>      // resolves on decide(), answer() or timeout ("expired")
  decide(sessionId: string, requestId: string, decision: PermissionDecision): void   // throws not_found
  answer(sessionId: string, requestId: string, option: string): void
  pending(sessionId: string): Activity[]           // merged into the activity feed
  cancelSession(sessionId: string): void
}

// src/owned/*
function createOwnedRunner(deps): OwnedRunner
type OwnedRunner = {
  start(req: NewSessionRequest): Promise<string>              // session id
  resume(sessionId: string): Promise<string>                  // lock: conflict if a live process holds it
  takeover(sessionId: string): Promise<string>                // end the terminal process, then resume
  fork(sessionId: string): Promise<string>
  clear(sessionId: string): Promise<string>                   // types /clear; re-keys the owned session to the new id
  compact(sessionId: string): Promise<void>                   // types /compact; resolves at the SDK compact_boundary message
  send(sessionId: string, text: string): void
  interrupt(sessionId: string): Promise<void>
  stop(sessionId: string): Promise<void>                      // end the owned process, session stays resumable
  isOwned(sessionId: string): boolean
  close(): Promise<void>
}

// src/foreign/*
function postToInbox(socketPath: string, text: string): Promise<void>
function sendEscape(tmuxBinary: string, pane: string): Promise<void>
function terminate(pid: number, deps): Promise<void>         // SIGTERM, wait for exit, throws on timeout

// src/push/*
function createApnsClient(deps): { send(token: string, env: ApnsEnvironment, payload: ApnsPayload): Promise<void>; close(): void }
function createNotifier(deps): { close(): void }             // subscribes to the bus, decides what to push
// "done" waits deps.doneDelayMs (default 20 s) after a Stop; a newer Stop for the session restarts the wait, and if the
// session is working again when it fires the push is dropped (log push_skipped {reason:"working again"}).
// While paused (deps.isPaused, backed by service/pauseStore.ts) nothing is pushed: push_skipped {reason:"paused"}.
// The wipe push of auth revoke talks to APNs directly and is not affected. Every send logs push_sent {type, sessionId, devices}.
function createDeviceStore(path: string): DeviceStore

// src/server/*
function createApp(services: Services): Hono                 // routes only; every handler is 1-5 lines
function startServer(app, config, bus): Promise<{ close(): Promise<void>; address: string; port: number }>

// src/service.ts - the one facade the server and tests talk to
function createServices(config: Config): Services             // wires everything above
```

## Session status mapping (one function: `src/sessions/status.ts`)

| Source | SessionSummary |
|---|---|
| no live process | `status: ended`, `replyMode: resume` |
| registry `busy` | `working` |
| registry `waiting` or a pending broker request | `waiting`, `waitingFor` from the broker or `permission` |
| registry `idle` or `shell` | `idle` |
| owned (runner has it) | `owned: true`, `replyMode: composer`, `canStop` while working |
| terminal, permission mode prompts, inbox socket present | `replyMode: composer` |
| terminal, bypass mode or no inbox socket | `replyMode: takeover` |
| terminal with a `tmux` pane | `canStop` while working |

## HTTP API

As in SPEC 3.4, all under bearer auth, JSON bodies validated with the contract schemas:

```
GET  /v1/machine                              -> Machine
GET  /v1/sessions                             -> SessionSummary[]
GET  /v1/sessions/:id/activity?before=&limit= -> ActivityPage
GET  /v1/sessions/:id/activity/:aid/detail    -> ActivityDetail
GET  /v1/folders/recent                       -> RecentFolders
WS   /v1/stream                               -> StreamEvent (hello first, then session/activity/ping)
GET  /v1/sessions/:id/attachment?path=<stored abs path> -> the stored bytes, content-type = stored media type (404 not_found unless that exact path was uploaded to this session)
POST /v1/sessions/:id/message  MessageRequest          -> MessageResult  (queued: true when a busy terminal session has not read it yet)
POST /v1/sessions/:id/stop                             -> OkResult
POST /v1/sessions/:id/kill                             -> OkResult
POST /v1/sessions/:id/resume                           -> ActionResult
POST /v1/sessions/:id/takeover                         -> ActionResult
POST /v1/sessions/:id/fork                             -> ActionResult
POST /v1/sessions/:id/clear                            -> ActionResult  (sessionId = the NEW id; see "/clear" below)
POST /v1/sessions/:id/compact                          -> ActionResult  (sessionId = the SAME id; see "Cold sessions" below)
POST /v1/sessions/:id/mute     MuteRequest             -> OkResult
POST /v1/sessions/:id/permission/:rid PermissionRequest -> OkResult
POST /v1/sessions/:id/answer/:qid     AnswerRequest     -> OkResult
POST /v1/sessions/new          NewSessionRequest       -> ActionResult
POST /v1/coordinator           CoordinatorRequest      -> ActionResult  (starts the coordinator session, or sends the prompt to the running one)
GET  /v1/notifications                                 -> NotificationState {pausedUntil | null}
POST /v1/notifications/pause   NotificationPauseRequest -> NotificationState  (minutes 0 = resume; persisted in <stateDir>/notification-pause.json)
GET  /v1/telemetry?since=&limit=&kind=error|event      -> TelemetryList  (kind absent = all; a report without kind counts as error; store rotates past 20 MB)
POST /v1/devices               DeviceRequest           -> OkResult   (also attaches the APNs token to the calling device)

POST /v1/auth/login            LoginRequest            -> LoginResult   (NO bearer; 501 until a password is set; 429 rate limited)
POST /v1/auth/logout           LogoutRequest           -> OkResult      (revokes the calling device token; master token: 400)
GET  /v1/auth/devices                                  -> AuthDeviceList (`current` marks the caller)
POST /v1/auth/revoke           RevokeRequest           -> RevokeResult  (id or name, null = all; silent wipe push + stream sockets closed)
POST /v1/auth/password         PasswordChangeRequest   -> OkResult      (verifies `current`, revokes ALL device tokens)
POST /v1/auth/reload                                   -> OkResult      (CLI hook: re-read the hash from the config file, revoke all)
```

Errors: `ErrorResponse` with status 401 (`unauthorized`, `token_revoked`), 404, 400, 409, 429 (`rate_limited`), 501, 500.
Bearer: the config `token` (pairing/master, device id `master`) or a device token from the registry. A revoked
device token answers 401 `token_revoked`; anything unknown 401 `unauthorized`.
WebSocket auth: `Authorization: Bearer` header on the upgrade request; a revoked token gets 401 with the same
JSON error body, and sockets of a device are closed (code 1008) the moment it is revoked.

## Auth (`src/auth`)

```ts
// password.ts - scrypt$N$r$p$salt$hash (N=2^15, r=8, p=1, 16-byte salt, 32-byte key)
hashPassword(password): Promise<string>;  verifyPassword(password, stored): Promise<boolean>  // malformed -> FardeskError("internal")
// rateLimit.ts - per-IP sliding window + global cap of 10x maxFailures
createLoginLimiter({ maxFailures, windowMs, now }): { check(ip) /* throws rate_limited */; recordFailure(ip); recordSuccess(ip) }
// deviceRegistry.ts - <stateDir>/auth-devices.json (600), SHA-256 of the token only, tombstones kept 90 days
createDeviceRegistry({ path, now }): { issue, authenticate, list, entries, revoke, revokeAll, attachPush, detachPush }
// service.ts - the facade the routes use (Services.auth)
createAuthService(deps): { authenticate, login, logout, devices, revoke, changePassword, reload, attachPush, onRevoked }
```

Config keys: `auth: { passwordHash, maxFailures: 5, windowSeconds: 300 }`, `peers: [{ name, url }]`,
`sessions: { maxEnded: 200, maxFolders: 20, readsPerPoll: 20 }`. `updateConfigFile(path, patch)` rewrites only the
given top-level keys (atomic, mode 600, validated).

CLI: `fardeskd set-password` (stdin; TTY prompts twice without echo, a pipe reads one line), `fardeskd devices`,
`fardeskd revoke <device|--all>`. They use the running daemon (master token, so wipe pushes and socket closing
happen) and fall back to the registry file when no daemon answers. Owner script for all machines:
`bash deploy/set-password.sh local laptop build-server`.

## Coordinator (`src/coordinator`, SPEC 4.5)

One fardeskd-owned session titled "Coordinator" with an in-process MCP server named `fardesk` (tools
`mcp__fardesk__*`): `list_sessions`, `read_activity {machine, sessionId, limit}`, `send_message {machine, sessionId, text}`,
`spawn_session {machine, cwd, prompt, model?, worktree?}`, `stop_session {machine, sessionId}` (interrupts the running turn).
Only those five tools are pre-approved (`allowedTools`); everything else goes through the normal permission broker.

- `backend.ts`: one `MachineEndpoint` per machine, this daemon via the `Services` facade, each peer from `config.peers` over HTTP
  (`remote.ts`, bearer token, every response validated with the contract schemas). `list_sessions {machine?, status?, limit=30}` returns compact rows
  `{machine, id, title, status, waitingFor, summary, updatedAt}` (cut at `limit`, with `matching` = rows before the cut) plus a report per
  machine `{machine, state: ok | not linked | unreachable, count, detail}` where `count` is the machine's total session count.
- `lines.ts`: the one function that turns an `Activity` into a text line, used by `read_activity`.
- `session.ts`: `createCoordinator` starts the owned session (the owned runner takes optional `SessionExtras`: MCP servers,
  allowed tools, appended system prompt, title) or sends the prompt to the one already running. It lives in
  `<stateDir>/coordinator`. After a daemon restart the owned session is resumed as a plain session without the tools; the next
  `POST /v1/coordinator` starts a fresh coordinator.
- Config: `coordinator: { peerTokens: { <peerName>: <token> }, model: null }`. A peer without a token is "not linked": its tools fail
  with a clear error. `model` null = the default model.

## Hub (`src/hub`, round 3)

One daemon can be the hub the apps and the CLI talk to; the others stay normal daemons. Config (default off):
`hub: { enabled: false, probeMs: 5000 }`. The peers are `peers: [{name, url}]`, their tokens `coordinator.peerTokens[name]`.

Per peer the hub keeps one upstream WebSocket to `<peer>/v1/stream` (bearer = the peer token, reconnect 1 s doubling to 15 s)
and probes `GET /v1/machine` every `probeMs`. It caches machine, sessions (hello/session events), online, lastSeen, latencyMs,
a plain-words `problem` ("no answer within 5 s", "refused the hub's token", "connection refused ...", "not linked: no token for it
in coordinator.peerTokens") and the latest activity rows (max 200) of every session whose page was requested, kept current by
`activity` events and dropped on every new `hello`.

```
GET  /v1/hub                          -> HubState (the hub first with hub:true, then every peer; counts of sessions/waiting/working)
ANY  /m/<urlencoded machine>/<path>   -> same as <path> on that machine
WS   /m/<machine>/v1/stream           -> that machine's StreamEvent stream
```

Rules for `/m/<machine>/...`:
- `<machine>` is the hub's own name: served by the local app (path rewritten). Unknown machine: 404 `not_found` naming the known ones.
- `/m/<any>/v1/auth/*` is always the hub's own auth; `POST /m/<any>/v1/auth/login` needs no bearer.
- Peer known offline: 503 `machine_offline` at once (`<name> is offline: <problem>; last seen <time>`).
- Peer GET `/v1/machine`, `/v1/sessions`, `/v1/sessions/:id/activity` (no `before`, only `limit`) come from the cache while the upstream
  stream is live; a session page that is not cached yet is fetched (200 rows), cached and returned.
- Everything else is forwarded with the peer token (method, query, body, headers); status, body and content-type pass through.
  Timeout 15 s, 120 s for paths ending in `new|resume|takeover|fork|clear|attachments` (240 s for `compact`); no answer = 503 `machine_offline`.
- `POST /m/<peer>/v1/devices` registers the device on the hub, then forwards it.
- Stream: after the normal token check the hub sends `hello` from its cache, then relays the peer's upstream events and pings. An
  offline peer refuses the upgrade with HTTP 503.

## Permission mode and /clear

Owned sessions run in `bypassPermissions` by default (`config.owned.permissionMode`, validated against `permissionModeSchema`);
that mode is passed to the SDK together with `allowDangerouslySkipPermissions: true`. Which mode a session gets:
- `POST /v1/sessions/new`: `request.permissionMode`, else the config default.
- resume, takeover, fork (of the source): the mode of the session's last turn from its transcript, else the config default.
- `SessionSummary.permissionMode` is that transcript mode (null when the transcript has none or a mode Claude Code does not know).

`POST /v1/sessions/:id/clear` -> `ActionResult { sessionId }` with the NEW session id:
- Owned session: `/clear` is pushed into the running SDK session. Observed 2026-11-16 (real claude): the SDK emits a
  `conversation_reset` frame whose `new_conversation_id` is NOT the id of the new transcript. The new id is the `session_id` of
  the `system/init` frame that follows, so an init frame with a different id re-keys the owned session (owned set, state file,
  broker, permission requests). The clear frame is followed by an empty `result` (0 turns).
- Terminal session in tmux or Ghostty: `/clear` + Enter is typed, then `~/.claude/sessions/<pid>.json` is polled for up to 15 s
  until it shows a new `sessionId`. Not seen in time: `internal`. A session waiting at a dialog: `conflict`.
- Terminal session outside tmux and Ghostty: 501 `unsupported` ("... Use Take Over, then Clear.").
- Ended session: 409 `conflict`.
- `POST /v1/sessions/:id/message` with the text exactly `/clear` is refused with 400 `invalid_request`; use the clear route.

## Cold sessions: contextTokens, cacheExpiresAt and /compact

- `SessionSummary.contextTokens` = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of `message.usage` of the
  LAST main-chain assistant line that has usage (sidechain/subagent lines do not count). Example from a real transcript:
  2 + 618 + 425,703 = 426,323.
- `SessionSummary.cacheExpiresAt` = that line's `timestamp` + 1 h when `usage.cache_creation.ephemeral_1h_input_tokens > 0`, else
  + 5 min (also when there is no `cache_creation` breakdown). Both fields are null when no assistant line has usage.
- `POST /v1/sessions/:id/compact` -> `ActionResult { sessionId }` (the same id):
  - Owned session: `/compact` is pushed into the running SDK session and the route resolves when the SDK stream emits the
    `system` message with `subtype: "compact_boundary"` (the transcript gets the same `system` line); 180 s timeout, then 409 `conflict`
    ("/compact did not finish within 180000 ms").
  - Terminal session in tmux or Ghostty: `/compact` + Enter is typed and the route returns at once.
  - Ended session: resumed as owned (last permission mode), then compacted.
  - Terminal outside tmux and Ghostty: 501 `unsupported` ("... Use Take Over first.").
  - `POST /v1/sessions/:id/message` with the text exactly `/compact` is refused with 400 `invalid_request`.

## Tests

Next to the source as `*.test.ts`. 100% lines, branches, functions and statements, enforced by
`vitest.config.ts`. Fixtures: `test/fixtures/transcripts/*.jsonl` (anonymised real transcripts),
`test/fixtures/hooks/*.json` (real hook payloads), `test/fixtures/registry/*.json` (real registry
files with neutral paths). Helpers shared by tests live in `test/support/` (temp Claude home
builder, free port, wait-until).

## Security defaults (supersede the older sections above where they differ)

Every default below is the safe one; each is a key in `config.json` and can be turned back.

| Key | Default | What it does |
|---|---|---|
| `owned.permissionMode` | `"default"` | Mode of owned sessions that name none. |
| `owned.allowBypass` | `false` | `bypassPermissions` is refused (501 `unsupported`, the message names the key) while false; a resumed session that last ran in bypass falls back to `owned.permissionMode`. A config that sets `bypassPermissions` as a mode without this switch does not load. `GET /v1/machine` reports it as `allowBypass`. |
| `coordinator.enabled` | `false` | `POST /v1/coordinator` answers 501 `unsupported` naming the key. Reported as `coordinatorEnabled`. |
| `coordinator.permissionMode` | `"default"` | `bypassPermissions` here also needs `owned.allowBypass`. |
| `coordinator.fullTools` | `false` | Built-in tools limited to Read and Grep (plus the fardesk tools, pre-approved). `true` = every tool. |
| `coordinator.mayApprove` | `false` | `answer_request` refuses `allow` and `allow_always` (deny still works). The system prompt always says session output is untrusted data. |
| `push.content` | `"generic"` | APNs payload says "Fardesk" and "A session on <machine> needs you / is done / has ended". `"full"` adds titles, summaries and assistant text. |
| `bind.allowNonTailnet` | `false` | Start only on `tailscale`, loopback or 100.64.0.0/10. Any other address needs `tls` and this flag. |

Pairing: `fardeskd pair` asks the running daemon for a one-time code (`POST /v1/auth/pair-code`, master token only; 32 random
bytes, held hashed in memory, valid 10 minutes, single use). The link carries `{v, name, url, code, hub}`, never the master token.
The app exchanges it at `POST /v1/auth/pair` (no bearer, rate limited like login) for a device token of its own. Old links with
`token` still work in the app. `fardeskd rotate-token` replaces the master token (`POST /v1/auth/rotate-token`, master only); device
tokens stay valid, and every hub that holds this machine in `coordinator.peerTokens` must be given the new token.

Attachments: a `content-length` is required, the body is read as a stream and cut off at 20 MB, 200 MB per session in total,
stored files are served only when they are still regular files (`lstat`), and each `.fardesk/` folder gets a `.gitignore` with `*`.

Audit: `<stateDir>/audit.jsonl` (mode 600, rotated at 1 MB to `audit.jsonl.1`): one line per state-changing request and per rejected
login or pairing, with time, device id, method, route pattern, session id, result and IP, never message text. `fardeskd audit [--since 2h]` prints it.

Hooks and passwords: `install-hooks --dry-run` prints the diff of each `settings.json` and writes nothing; `install-hooks` refuses a state
directory that group or others can read. The minimum password length is 12.
