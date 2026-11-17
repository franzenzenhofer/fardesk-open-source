# Registry fixtures

Neutralised copies of `<claudeHome>/sessions/<pid>.json` (Claude Code 2.1.325). Paths, names and uuids are fake; keys and value types are kept.

Real-derived (copied from files on the dev Mac, values neutralised):
- `idle.json`, `busy.json`, `shell.json`

Constructed from the documented facts only (no real file was available):
- `constructed-waiting.json` (status `waiting`, `waitingFor`)
- `constructed-tmux.json` (`tmux` field)
- `constructed-sdk-ts.json` (`entrypoint` `sdk-ts`, `kind` `bg` with `jobId`, `name` null, no `messagingSocketPath`)

Tests rewrite `pid` to real live or dead pids.
