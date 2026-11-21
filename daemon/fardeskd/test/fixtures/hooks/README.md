# Hook fixtures

Real hook stdin payloads captured during a hook spike, Claude Code 2.1.325.
Every key and value type is kept. Only the home directory (`/home/dev`), the user name and the
scratchpad uid are neutralised.

- `*.json`: one payload per interesting case.
- `settings/`: installer inputs. `empty-object.json`, `no-hooks.json`, and `existing-hooks.json`
  (mirrors the real structure of a settings file that already carries PreToolUse, Stop and
  UserPromptSubmit hooks).
