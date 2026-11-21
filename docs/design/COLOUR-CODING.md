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
| Grey | Inactive: idle, ended, offline, connecting, queued, plain information | `StateColor.inactive` = `Color.secondary` | `.inactive` |

- **Blue is not a state colour.** It is not used anywhere for state. A working session is green.
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
| | idle | grey |
| | ended | grey |
| Session title line | dot + status word | same as the session; status word orange only when waiting |
| Session row glyph | play (working, pulses) | green |
| | exclamation (waiting) | orange |
| | pause (idle), check (ended) | grey |
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
| | held (waiting for your choice) | orange |
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
| Row swipes | Allow | green |
| | Answer (a question waits) | orange |
| | Open | grey |
| | Deny, End session | red |
| Voice recording | record dot, level meter (mic is live) | green |
| | Stop and send | green |
| Errors (login, pairing, attachment, dictation) | error text | red |
| Destructive buttons (`role: .destructive`, `.fardeskDestructive`) | End session, Revoke, Log Out, Delete | red |
