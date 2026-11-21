# Session labels: rename, colour, pin (2026-11-17)

Goal: colour code and rename sessions from the session menu, and pin them with a swipe action on the list.

## Contract (daemon <-> app)

Every `SessionSummary` gets one new field, always present:

```json
"label": { "name": "Release work", "color": "blue", "pinned": true }
```

- `name`: string 1-80 chars after trim, or `null` (no custom name: the app shows `title`). `title` itself never changes.
- `color`: one of `"blue" | "teal" | "purple" | "pink"`, or `null`. These four never overlap the status colours
  (red broken, grey inactive, orange needs you, green OK - see COLOUR-CODING.md).
- `pinned`: boolean.

New route, same shape as `/mute`:

`POST /v1/sessions/:id/label` with a strict body where every key is optional (a patch):
`{ "name"?: string | null, "color"?: "blue"|"teal"|"purple"|"pink" | null, "pinned"?: boolean }`.
An empty name after trim is stored as `null`. Unknown session id: the same error as `/mute`. Answers `{ ok: true }`.
The hub proxy `/m/<machine>/v1/...` forwards it unchanged.

Storage: `labels.json` in `stateDir`, strict zod, same helper as `mutes.json`; an entry whose name and colour are
null and pinned is false is removed. A pinned ended session stays in the list even past `listEnded` /
`listEndedWithinDays` (pinning means "keep it here").

## App

- Long-press menu and the Session info sheet: "Rename..." (text field alert, empty = back to the original title),
  "Colour" submenu (None, Blue, Teal, Purple, Pink, each with a filled dot), "Pin" / "Unpin".
- Row: shows `label.name ?? title`; a coloured bar on the leading edge when a colour is set; a pin glyph when pinned.
- Swipe from the leading edge (left to right): Pin / Unpin, next to the existing unblock swipe.
- Pinned sessions come first inside their machine section, then the usual order.
- Older daemons without `label`: decode as no label; the actions show an error notice "update the daemon".
