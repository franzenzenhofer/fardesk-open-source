# Architecture

Fardesk has three parts: a daemon (`daemon/fardeskd`, TypeScript on Node), a Swift package shared by the app
and the command line tool (`packages/FardeskKit`), and the app itself (`apps/Fardesk`, SwiftUI for iOS 26 and
macOS 26). There is no server run by the project. The app talks to your daemons directly or through one of them
(the hub).

```text
 iPhone / Mac app  --- Tailscale (WireGuard), HTTP + WebSocket, bearer token --->  fardeskd (hub)
                                                                                      |
                                                              Tailscale               |   same machine
                                                        +-----------------------------+---------------+
                                                        v                                             v
                                                 fardeskd (peer)                          Claude Code sessions
                                                        |
                                                 Claude Code sessions
```

## Two kinds of sessions

| | Observed (started in a terminal) | Owned (started or taken over by the daemon) |
|---|---|---|
| How Fardesk finds it | Claude Code hooks and the session registry in `~/.claude/sessions` | the daemon started it |
| Live activity | the transcript file (JSONL) under `~/.claude/projects` | the Agent SDK message stream |
| Reply | typed into tmux or Ghostty | a real user message through the SDK |
| Approve or deny | the blocking `PermissionRequest` hook | the SDK permission callback |
| Interrupt, model, effort, slash commands | limited | yes |

"Take over" stops the terminal process and resumes the same session under the daemon. Only one process owns a
session at a time.

## The daemon

Modules under `daemon/fardeskd/src` (one responsibility each; the module boundaries and the HTTP API are
written down in [DAEMON.md](DAEMON.md)):

| Module | Job |
|---|---|
| `config`, `auth`, `pairing` | config file, tokens, password, device registry, one-time pairing codes |
| `server`, `contract` | HTTP and WebSocket routes; the zod schema that is the wire contract (JSON schema is generated from it) |
| `transcript`, `sessions`, `foreign` | the one place that understands Claude Code transcript lines; session store; observed sessions |
| `owned` | sessions started through the Claude Agent SDK |
| `hooks` | installs hook entries, receives hook events on a Unix socket (mode 0600) |
| `permissions` | holds permission requests until a device answers |
| `hub` | proxies `/m/<machine>/...` to peers and merges their streams |
| `coordinator` | optional Claude Code session with tools to read and steer other sessions (off by default) |
| `push` | optional Apple push; generic text by default |
| `attachments`, `folders` | files sent from the phone; folder search for "new session" |
| `audit`, `telemetry` | local audit log and local diagnostics; nothing leaves the machine |

Rules the code follows: no mutable module state, every outside dependency (paths, clock, sockets, child
processes) passed in, everything read from disk parsed with zod, errors are `FardeskError` with a contract
code, no mocks in tests (real temp folders, real sockets).

## The app and the Swift package

`FardeskModels` (wire types), `FardeskClient` (HTTP and WebSocket client), `FardeskStore` (state, ordering,
alert policy), `FardeskCLICore` and `fardesk` (the command line tool). The app is a thin SwiftUI layer over the
store. Colours and state names follow one table so a state looks the same everywhere.

## Boundaries and trust

- The wire contract is `daemon/fardeskd/src/contract/schema.ts`; Swift types are tested against the generated
  JSON schema fixtures.
- The daemon trusts a valid token completely. Everything that limits what a token can do (bind address, pairing,
  permission mode, Coordinator switch) is described in [SECURITY.md](../SECURITY.md).
- The only code that parses Claude Code's own files is in `transcript`, `sessions` and `hooks`. These files are
  not documented by Anthropic; fixtures of real (anonymised) sessions pin the behaviour.
