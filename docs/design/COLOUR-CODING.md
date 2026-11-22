# Colour coding

The rule (2026-11-17): red is only ever used for something that is broken. Grey is for something that is not
active or offline. Orange is for something that needs the user's attention - a clear orange. Green is for
everything that is online or just okay, active.

## The rule

The app is black and white. Colour means state, and there are exactly four state colours:

| Colour | Meaning | Swift (`StateColor`) | Meaning enum (`StateTone`) |
|--------|---------|----------------------|----------------------------|
| Red | Broken: an error, a failure, or an action that breaks something (End session, Revoke, Log Out, Deny) | `StateColor.broken` = `Color.red` | `.broken` |
| Orange | Needs you: a permission, a question, a choice, a login only you can do | `StateColor.needsYou` = `Color.orange` (system orange, never brown, gold or amber) | `.needsYou` |
| Green | OK: online, working fine, active, done, live | `StateColor.ok` = `Color.green` | `.ok` |
| Black | Your turn: a session that finished its turn and waits for your next message. The text colour, not a fifth colour | `StateColor.ready` = `Color.primary` | `.ready` |
| Grey | Inactive: stopped, offline, connecting, queued, plain information | `StateColor.inactive` = `Color.secondary` | `.inactive` |

- **The list row is the one exception** (owner design kit, 2026-11-22, `LIST-ROW.md`): its state badge draws
  "Your turn" in purple `#514A92` instead of black, and the agent avatars have their own soft tile colours.
  The badge colours live in `SessionBadge.colourHex`.
- **Blue is not a state colour.** A working session is green. Its one use (owner, 4.1.0) is the delivery check marks under
  your own message, as in chat apps: one grey check = the computer took it (Claude is busy and reads it after its turn),
  one blue check = it is in the Claude session, two blue checks = Claude read it.
- **Text and buttons stay black and white** (`.primary`, `.secondary`, `FardeskButtonStyle`). The app tint is `.primary`.
  The only coloured text is a state word next to its dot (e.g. "3 needs you", "Not sent: offline").
- **No permanent spinner for "working".** A working session is a green dot or glyph; the row glyph may pulse
  (`symbolEffect(.pulse)`), nothing else. No `ProgressView` in titles or rows.
  A small spinner is allowed only for a short, user-started wait that ends by itself (a notice running, a
  message sending, a step running, the first hub connect, a login in progress).
- **One source of truth.** State meaning lives in `packages/FardeskKit/Sources/FardeskStore/StateTone.swift`
  (pure, unit tested in `StateToneTests`). Colours live only in
  `apps/Fardesk/Sources/DesignSystem/StateColor.swift`. No view writes `.red`, `.orange`, `.green`, `.blue`
  or `.gray` itself.

## Every state

| Where | State | Colour |
|-------|-------|--------|
| Session (`SessionStatus`) | working | green |
| | waiting (permission or question, `WaitingReason`) | orange |
| | idle ("Your turn") | black |
| | ended ("Stopped") | grey |
| Session title line | dot + status word | same as the session; status word orange only when waiting |
| Session row glyph (STATES.md) | three dots (working, pulses) | green |
| | exclamation (needs your approval or answer), computer (needs you at the computer) | orange |
| | reply arrow (your turn) | black |
| | stop sign (stopped) | grey |
| | never a pause sign, never a check mark | |
| Session row edge | no colour picked: live | black bar |
| | no colour picked: stopped | grey bar |
| | colour picked: live / stopped | the colour / grey bar plus the colour |
| Machine connection (`ConnectionState`) | online | green |
| | connecting | grey |
| | offline | grey (row dimmed) |
| | logged out (token refused, log in again) | orange |
| Hub (`HubStatus`) | connecting | grey spinner + grey text |
| | reachable | nothing shown |
| | unreachable | red symbol |
| Outbox (`PendingMessage.State`) | queued | grey |
| | sending | grey spinner |
| | sent | green check |
| | failed | red symbol + red label |
| Notices (`ActionFeedback.State`) | running | grey spinner |
| | succeeded | green check |
| | failed | red cross |
| | info | grey |
| Step log (`StepLog.State`) | running | grey spinner |
| | done | green check |
| | failed | red cross |
| Request card (permission or question) | shield | orange |
| Machine TOC chip | dot online / offline | green / grey |
| | "N needs you" | orange |
| Bottom bar | "N needs you" | orange |
| Row swipes | Pin, Unpin (left to right) | black |
| | End this chat (right to left, live) | red |
| | Remove from list (right to left, stopped) | grey |
| Voice recording | record dot, level meter (mic is live) | green |
| | Stop and send | green |
| Errors (login, pairing, attachment, dictation) | error text | red |
| Destructive buttons (`role: .destructive`, `.fardeskDestructive`) | End session, Revoke, Log Out, Delete | red |

## Label colours (session colour labels)

The colour of a session is a dot or bar next to it, never the colour of its text: text stays black or white. It is the
user's own pick (`#RRGGBB`, any colour) or, with "Automatic colours" on (off by default since 4.1.0: colouring
every row made them all look active), the daemon's `autoColor`, always one of the 64
presets in `daemon/fardeskd/src/contract/palette.ts`. The presets are never red, orange, green or grey, so a label colour is
never mistaken for a state; `palette.test.ts` and `LabelPaletteTests` check this (CIEDE2000 distance of at least 15 to the
four state colours), that every preset has a contrast of at least 2:1 on white and on black (WCAG 2.1 contrast ratio,
https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio) and that every two presets are at least 7 apart. A colour chosen with the
system picker is the user's own choice and is not checked.
