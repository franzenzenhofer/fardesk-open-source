# Session labels: rename, colour, pin (2026-11-17)

Goal: colour code and rename sessions from the session menu, and pin them with a swipe action on the list.

## Contract (daemon <-> app)

Every `SessionSummary` gets one new field, always present:

```json
"label": { "name": "Release work", "color": "#1AA1FB", "pinned": true },
"autoColor": "#0B9371"
```

- `name`: string 1-80 chars after trim, or `null` (no custom name: the app shows `title`). `title` itself never changes.
- `color`: the user's own colour, `#RRGGBB` in upper case, or `null`. Any such colour is valid (the system colour picker
  can choose any); anything else (a name, lower case, `#FFF`) is a 400 `invalid_request`. There are no colour names on
  the wire.
- `autoColor`: the colour the daemon gave the session (automatic colour coding), always one of the 64 presets, or `null`
  while it has none yet. The user's `color` wins over it.
- `pinned`: boolean.

### The 64 presets

Defined once in `daemon/fardeskd/src/contract/palette.ts` and generated into
`daemon/fardeskd/schema/fixtures/LabelPalette/presets.json` (name and colour, in picker order = hue order). The app's table
(`LabelPalette`) must equal that file (`LabelPaletteTests`). They are never red, orange, green or grey (those mean state,
COLOUR-CODING.md), all visible on white and on black (contrast at least 2:1, WCAG 2.1) and every two at least 7 apart in
CIEDE2000 (`palette.test.ts`, `LabelPaletteTests`, with the reasons for the numbers).

### Automatic colour coding

On by default (Settings, "Automatic colours", per device). The daemon assigns each session its colour once, in
creation order (oldest first, then session id): the preset farthest in CIEDE2000 from every colour shown for the other
sessions of the machine (user picks included), so taken or too-close colours are skipped; with all 64 in use the least
used one repeats. The assignment is kept in `auto-colours.json` in `stateDir`, so it is the same after a restart and on
every device. The user's colour always wins; with the switch off only user-picked colours show. The colour is shown as the
bar next to the session, never as text colour.

New route, same shape as `/mute`:

`POST /v1/sessions/:id/label` with a strict body where every key is optional (a patch):
`{ "name"?: string | null, "color"?: "#RRGGBB" | null, "pinned"?: boolean }`.
An empty name after trim is stored as `null`. Unknown session id: the same error as `/mute`. Answers `{ ok: true }`.
The hub proxy `/m/<machine>/v1/...` forwards it unchanged.

Storage: `labels.json` in `stateDir`, strict zod, same helper as `mutes.json`; an entry whose name and colour are
null and pinned is false is removed. A pinned ended session stays in the list even past `listEnded` /
`listEndedWithinDays` (pinning means "keep it here").

## App

- Long-press menu and the Session info sheet: "Rename..." (text field alert, empty = back to the original title),
  "Colour" submenu (the most used presets as a palette row, "More colours", "No colour"), "Pin" / "Unpin". The info sheet has the
  grid of 64 presets (44 pt targets, ring and check on the current one), "no colour" and the system `ColorPicker` without opacity.
- Row: shows `label.name ?? title`; a coloured bar on the leading edge (the user's colour, else `autoColor` while "Automatic colours" is on); a pin glyph when pinned.
- Swipe from the leading edge (left to right): Pin / Unpin, next to the existing unblock swipe.
- Pinned sessions come first inside their machine section, then the usual order.
