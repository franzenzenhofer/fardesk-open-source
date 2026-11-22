# STATES.md - every state, every screen (4.1.0)

Owner: the product manager. Every 4.1.0 ticket takes its acceptance
from this file; a build is accepted only when each row below matches the demo screenshots. Code that implements a
row names it (`STATES.md S3`). Change a row here first, then the code.

Design principle (owner, 2026-11-22): do not make the app more complicated. Very clean, but every piece of
information that is shown makes sense to a non-specialist at a glance: what it is, what state it is in, what to do.

Words in the tables are the exact strings. `<...>` is filled from data. "·" is the separator `FeedSymbol.separator`.
"Today" notes describe 4.0.1 (commit 518232e) where it differs; file:line refers to that commit.

## Rules that hold for every row

1. **Attention is always actionable.** Every session that counts as "needs you" (orange, counted in the bottom
   bar "N needs you") shows exactly one card in its chat the moment the chat opens, and that card has at least one
   button that does something. No orange row without a card, no card without a button. Test: `AttentionInvariant`.
2. **One status word per state**, one icon per state, one colour per state, from one table in `FardeskStore`
   (`SessionPresentation` + `SessionRowGlyph`). App, CLI, widget, Live Activity and push use the same words.
3. **No pause sign and no check mark as a status** anywhere. "Can resume" is never a status.
4. **Colour means state** (`public/docs/design/COLOUR-CODING.md`): green working, orange needs you, black your
   turn, grey stopped / offline, red broken or destructive. The only other colours are the user's own labels.
5. **Nothing runs on a swipe alone.** One button per side, `allowsFullSwipe: false`, an action runs on tap.
6. **The row is the owner's design kit** (`LIST-ROW.md`): agent avatar with the state badge, title with the time,
   one muted preview "State · newest line". No home chip, no chevron, no tags.
7. **Power settings live in Settings**, never on the list or the chat.
8. **Demo:** everything that needs a real machine is greyed out and not tappable (row D1).

## Row anatomy (list)

See `LIST-ROW.md` (since 2026-11-22). In the table below, "List icon" is the badge on the avatar there
(working, in background, needs you, your turn, stopped) and "Colour bar" is the ring around the avatar: only the
user's colour, no black or grey bar.

## Session states - list and swipes

| ID | State (daemon) | List icon + colour | Status word + sentence | Colour bar | Swipe left to right | Swipe right to left |
|----|----------------|--------------------|------------------------|------------|---------------------|---------------------|
| S1 | working | `ellipsis.circle.fill`, green, pulses | "Working" · what it does now (daemon `summary`) | black; manual colour if set | Pin / Unpin | End this chat |
| S2 | working in the background (idle, a background job of the agent still runs; A3) | `ellipsis.circle`, green outline, no pulse | "In background" · what runs | black; manual colour | Pin / Unpin | End this chat |
| S3 | waiting, permission | `exclamationmark.circle.fill`, orange | "Needs your approval" · `<tool>: <summary>` | black; manual colour | Pin / Unpin | End this chat |
| S4 | waiting, question | `exclamationmark.circle.fill`, orange | "Needs your answer" · the question | black; manual colour | Pin / Unpin | End this chat |
| S5 | waiting, terminal (any source, see S5a-c) | `desktopcomputer`, orange | "Needs you at the computer" · the dialog text, if known | black; manual colour | Pin / Unpin | End this chat |
| S6 | idle | `arrowshape.turn.up.left.circle.fill`, black | "Your turn" · last line of the answer | black; manual colour | Pin / Unpin | End this chat |
| S7 | ended | `stop.circle`, grey | "Stopped" (no sentence) · 2h | grey; plus the manual colour bar next to it if set | Pin / Unpin | Remove from list |
| S8 | hidden (removed from list, new daemon set) | not in the list | - | - | - | - |
| S9 | waiting, reason unknown (`waitingFor == nil`) | should not happen; `exclamationmark.circle.fill`, orange | "Needs you" | as S5 | as S5 | as S5 |
| S10 | starting (placeholder while a session starts) | `ellipsis.circle.fill`, grey | "Starting" · "Starting Claude on <machine>" | black | none | none |

Notes:
- Today (4.0.1): working `play.circle.fill` (`SessionRowGlyph.swift:14`) but `circle.dotted` in `FardeskSymbol.swift:5`
  (two tables disagree); idle `pause.circle.fill` "Idle"; ended `checkmark.circle` "Ended" + "Can resume"
  (`SessionPresentation.swift:41-58`); home chip in the row (`SessionRow.swift:41`); time column + chevron
  (`SessionRow.swift:49-50`).
- Swipes today: leading Open (+ Allow / Answer), trailing Deny, Stop, End session, full swipe on both sides
  (`SessionSwipePlan.swift:13-27`, `SessionRowSwipes.swift:19-23`). 4.1.0: exactly the two columns above.
- "End this chat" runs on tap, without a second dialog: a stopped chat can always be resumed, so nothing is lost
  (product decision, see PRODUCT-MANAGER.md). Fill: red (`SwipeFill.broken`). Pin: black (`SwipeFill.ready`).
  "Remove from list": grey (`SwipeFill.inactive`); undo in Settings > Sessions > Hidden chats.
- A hidden chat that becomes live again (resumed elsewhere) leaves the hidden set and shows again.
- Agent mark: monochrome line mark, 20 x 20, from `agent` on `SessionSummary` (`claude` | `codex`). Same colour as
  the title text. Never a brand colour.
- "All homes" filter menu (owner item 23): shown only when a machine has more than one Claude home. Once other
  agents exist it becomes one grouped menu: All / Claude Code (each home) / Codex / Pi, a group only when it has
  sessions. The home name itself is never on a row; it is in the info sheet.
- Title: up to 2 lines; when longer, it ends with "..." at a word boundary and the chat header shows it in full.

## Session states - chat and push

| ID | Chat header (under the title) | Chat card (what to act on) | Chat footer | Push text | Tapping the push opens |
|----|-------------------------------|----------------------------|-------------|-----------|------------------------|
| S1 | "Working" (green) · machine | none | composer + Stop button; if the terminal cannot be typed into: "Running in a terminal" + "Take over" | none | - |
| S2 | "In background" (green) · machine | none | composer | "done" push waits until the background job ends | - |
| S3 | "Needs your approval" (orange) · machine | Permission card: tool, what it will do, folder; buttons Allow, Deny (Allow always when offered) | composer stays below the card | title: chat title; body: `<tool>: <summary>`; actions Allow, Deny | the chat, scrolled to the card |
| S4 | "Needs your answer" (orange) · machine | Question card: the question; one button per option | composer (free answer) | title: chat title; body: the question; action Reply | the chat, scrolled to the card |
| S4b | "Needs your answer" (orange) · machine | Dialog card (feature `claude-dialogs`): Claude Code's own title and words, one button per choice it offers. "Resume this conversation?": "This conversation has been inactive for 3 h and is 426k tokens long. Resuming it will use about 12% of your 5-hour usage limit." with Resume, Start a new conversation, Resume from summary, Not now. A dialog kind this app cannot show: "Claude Code asks something this app version cannot show. Answer at the computer or update the app." with only Not now | composer stays below the card | none from the app | the chat, scrolled to the card |
| S5a | "Needs you at the computer" (orange) · machine | Terminal card (hand-off, terminal can be typed into): "Waiting at the computer", the dialog text, one button per option (question) or Allow / Deny (permission) | composer | "Still waiting at the computer: <request>" (replaces the request push, same collapse id); no actions | the chat, scrolled to the card |
| S5b | same | Terminal card (hand-off, cannot be typed into): "Waiting at the computer", the dialog text, buttons "Take over" (continue the chat on this device; Claude asks again here) and "Fix it", line "Or answer at the computer." On the Mac app, when the session runs on this Mac, "Take over" becomes "Show in terminal" | "Running in a terminal" + "Take over" (the chat cannot be typed into while the dialog waits) | as S5a | the chat, scrolled to the card |
| S5c | same | Terminal card from the registry alone (no request held by the daemon, e.g. after a daemon restart or a dialog that never asked the phone): "Waiting at the computer", the dialog name if the registry gives one, else "A dialog is open in the terminal", buttons "Take over" and "Fix it", line "Or answer at the computer." | as S5b | none (product decision: no push for registry-only waits in 4.1.0) | - |
| S9 | "Needs you" (orange) · machine | the S5c card | as S5b | none | - |
| S6 | "Your turn" (black) · machine | none | composer; a message is sent at once, the app asks nothing first | "done": title: chat title; body: last answer, up to 160 characters; actions Reply, Open | the chat, at the end |
| S7 | "Stopped" (grey) · machine | none | status line "Stopped 2 h ago", then buttons Resume, Resume from summary, Start fresh here (no composer) | "ended": body: session summary or "Session ended" | the chat, at the end, footer visible |
| S8 | (opened from Settings > Sessions > Hidden chats) as S7 + "Restore to list" | none | as S7 | none | - |
| S10 | step log "Starting Claude on <machine>..." | none | composer disabled until the session exists | none | - |

Notes:
- A request push (S3, S4) is withdrawn on every device the moment the request is answered anywhere else (phone,
  other device, terminal) or expires: a quiet "resolved" push with the same collapse id replaces it.
- The "Start fresh here" button starts a new chat in the same folder, with the same permission mode and the same
  Claude home. For a live chat the same button clears it ("Clear" = same folder, fresh context).
- Cancel exists only inside dialogs, never as a footer button.
- Info sheet (chat title tap): sections "Name", "Colour", "Pinned" (three, not "Your label"); facts: Machine,
  Claude home (last path part, e.g. `.claude`), Started in (start folder), Folder, Model, Permission mode, Started,
  Last activity.
- Actions menu (owner item 20): "Fix it" is a top-level item (and a button on every at-the-computer card, S5a-c,
  S9). It starts a new chat with a fix prompt (what the stuck chat waits on, its folder, its id) on the session's
  machine; if that machine is offline, on the coordinator's machine; both offline: "Fix it needs <machine> or the
  coordinator online. Both are offline." and nothing starts. Fork moves under "More".

## Opening a chat (owner item 21: fast, never stuck)

- The chat opens at once at the newest rows: from the cache if there is one, else the newest page (50 rows) from
  the daemon. Any open card (S3-S5, S9) and the footer show in the first frame that has data.
- Never the full history first: older rows load only when the owner scrolls up ("Load earlier").
- No blocking spinner over the chat. While the newest page loads, the step log row says "Loading the last 50
  rows..."; when it fails, it says why in plain words and the cached rows stay.
- Targets (checked on the demo world and on one live huge chat): first content from cache under 0.5 s, from the
  network under 2 s; a chat of any length opens within the same time as a short one.
- Today (4.0.1): the app already shows the cache first and asks for 50 rows (`AppModel+Actions.swift:42-62`,
  `firstPageRows = 50` in `AppModel+Steps.swift:8`) and records `session.open` timings. Where the time goes on a
  huge chat (daemon reading the whole transcript for one page, the stream, or the app rebuilding derived rows) is
  not measured yet: the ticket measures first, then fixes the slow part.

## Attention sources (why a "needs you" opened a chat with nothing to act on)

Verified against commit 518232e (4.0.1). Each source has a ticket; a fix is accepted when its row above holds.
Tickets: a, b, h -> #109; c, d, e -> #110; f, g -> #112; background work -> #111; invariant tests -> #113
(all under #101 and the 4.1.0 epic #130).

| # | Source | Where (4.0.1) | Effect | Target row |
|---|--------|---------------|--------|------------|
| a | Registry-only terminal wait: Claude Code's registry says "waiting" and the daemon holds no request, so the session is reported `waiting / terminal`. The chat shows cards only for broker activities (pending or handed-off requests), so there is no card. | `daemon/fardeskd/src/sessions/status.ts:80-85` (`waitingOf`), `apps/Fardesk/Sources/SessionFeedOverlays.swift:10-15` | orange row, empty chat | S5c |
| b | Daemon restart: the broker keeps requests only in memory, so after a restart a dialog still open in the terminal has no request; it falls into (a). | `daemon/fardeskd/src/permissions/broker.ts:132-133` (ledger is a `Map` in memory), `broker.ts:243-245` (`close` expires all) | orange row, empty chat | S5c |
| c | After an answer from the phone the broker resolves the request at once (`pendingKind` = null), but Claude Code's registry still says "waiting" until it rewrites its file; until then `status.ts:84` reports a terminal wait. Registry poll: 1 s (`config/config.ts:31`). My inference: the window is one poll or longer, depending on when Claude Code writes the registry. | `status.ts:83-84`, `permissions/broker.ts:137-143` | after answering, the row turns "Needs you at the computer" with no card for a moment | S3 -> S1, no S5 flash (grace: one registry change) |
| d | A handed-off question never expires on tool finish: `isCallOf` returns false for anything but a permission, so only the registry leaving "waiting" or the session ending clears it. | `permissions/broker.ts:213-216`, called from `service/core.ts:81-83` | stale "Waiting at the computer" question card | S1 / S6 |
| e | The app's feed refresh only upserts: a cached pending card that the daemon no longer lists stays on screen. | `packages/FardeskKit/Sources/FardeskStore/SessionFeed.swift:65-77` (`var changed = false`, line 73) | a card for a request that no longer exists | card disappears when the daemon stops listing it |
| f | Pushes are never withdrawn: the notifier pushes only pending requests and nothing on resolve; the app removes delivered notifications only when push is switched off. | `daemon/fardeskd/src/push/notifier.ts:196-199`, `apps/Fardesk/Sources/PlatformPush.swift:38` | an old "needs you" push opens a chat with nothing to do | push withdrawn (S3, S4 notes) |
| g | The hand-off push fires on every broker time-out without checking that the dialog still waits. | `daemon/fardeskd/src/service/hooks.ts:33-34`, `push/notifier.ts:204-208` | "Still waiting at the computer" when nothing waits | S5a push only while it waits |
| h | A handed-off request whose terminal cannot be typed into shows a card with no button: only "Answer at the computer". | `packages/FardeskKit/Sources/FardeskStore/TerminalRequestPresentation.swift:21-25`, `apps/Fardesk/Sources/TerminalRequestCard.swift:20-32` | card with nothing to tap | S5b |

## Machine states (section header in the list)

| ID | State | Header (name + word) | Rows | Tap on the header opens | Words in the sheet |
|----|-------|----------------------|------|-------------------------|--------------------|
| M1 | online | name, green dot, no word | normal | nothing (long press: reorder machines) | - |
| M2 | slow (the hub's probe timed out, or a direct request took longer than 5 s, while the connection stands) | name, grey word "Slow" | normal | reason sheet | "<machine> answers slowly (no answer within 5 s). It may be busy or on a weak network. Fardesk keeps trying." |
| M3 | offline: Tailscale off on this device | every machine: grey word "Offline"; one line at the top of the list: "Tailscale is off on this phone." | cached, dimmed | reason sheet | "Tailscale is off on this phone. Fardesk works only over Tailscale. Open the Tailscale app and turn it on." (from `TailscaleRequirement`) |
| M4 | offline: Tailscale off on that computer, or it is asleep / off | grey word "Offline" · "since 5m" | cached, dimmed | reason sheet | Hub knows (its Tailscale shows the peer offline): "<machine> is not on Tailscale. It is asleep or off, or Tailscale is stopped there. On that computer, turn Tailscale on." Direct mode, no answer: "No answer from <machine>. It is asleep or off, or Tailscale is stopped there." |
| M5 | offline: daemon not running (connection refused) | grey word "Offline" | cached, dimmed | reason sheet | "<machine> is on Tailscale, but Fardesk is not running there. On that computer, run `fardeskd status`." |
| M6 | refused token (logged out) | orange word "Pair again" | cached, dimmed | reason sheet with button "Pair again" (opens the scanner) | "<machine> no longer accepts this device: the pairing was removed, or Tailscale was reinstalled here. Pair again: on that computer run `fardeskd pair`." |
| M7 | unknown (no answer yet, no reason known) | grey word "Connecting", after 10 s "No answer" | cached, dimmed | reason sheet | "No answer from <machine> since <time>. Fardesk cannot tell why yet. Check that the computer is awake and Tailscale runs there." |

Notes:
- The daemon cannot report "waiting for Tailscale" itself: while Tailscale is off it has no tailnet address and
  listens nowhere (it binds only to the tailnet address). The reason in M4 comes from the hub's own Tailscale view
  of its peers; in direct mode from the phone's own check (is the phone on Tailscale, refused or timed out).
- The daemon's stdout log lines carry an ISO-8601 UTC timestamp, so "waiting for Tailscale: stopped" says when.
- Today (4.0.1): the header shows "Offline" + "since"; the hub's `problem` text exists (`MachinePresentation.swift:33`)
  but no tap shows it; there is no slow state.

## Coordinator (toolbar button, people icon)

| ID | State | Toolbar button | Tap opens |
|----|-------|----------------|-----------|
| K1 | available (hub machine online, coordinator enabled) | black | the coordinator chat |
| K2 | turned off on the hub | grey with a small dot | sheet: "The coordinator is off on <hub>. It can run commands and answer for your sessions, so it starts only when you turn it on on that computer." |
| K3 | hub offline | grey with a small dot | the hub's reason sheet (M2-M7) |

## Demo

| ID | State | What shows | What is greyed out and not tappable |
|----|-------|------------|-------------------------------------|
| D1 | demo world (fake data) | one small inline line at the top of the list content: "Demo content", never floating over anything; all rows S1-S7 and machines M1-M7 for browsing; chats open read-only | composer and send, swipe buttons, Actions menu, New session, Fix it, card buttons (Allow, Deny, options, Take over), footer buttons (Resume, Resume from summary, Start fresh here), Pair again, notification settings, add / remove machine |

## Settings (one level down, iOS-style drill-down)

Machines (order, shown name, hub, add by QR, remove = delete this pairing) · This device (name, paired since,
Tailscale node) · Notifications (each push type, per machine, muted chats with unmute, quiet "done" pushes) ·
Appearance (Automatic colours, default off; list density) · Sessions (show stopped for N days, Hidden chats with
Restore) · Voice · Security (Face ID, lock after N min) · Data (clear cached chats, export diagnostics log) · Demo
· About (app and each daemon version, open source, licences, privacy) · Danger zone (Delete all pairings, Factory
reset; both confirm in a dialog).

## Review checklist (the PM walks this for every build)

For each row ID above: one demo screenshot (the app's built-in demo; at most one iOS simulator, on
the owner-approved machine, shut down right after), then check icon, colour, word,
sentence, bar, swipes, header, card, footer, push. Any extra element on a list row or the chat footer that is not
in this file is a rejection.
