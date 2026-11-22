# Session list row

Owner design kit, 2026-11-22. It replaces the 4.1.0 row (status glyph, agent mark, colour bar). Code:
`apps/Fardesk/Sources/SessionRow.swift` (view, `RowMetrics`), `packages/FardeskKit/Sources/FardeskStore/SessionRowModel.swift`
(what a row shows, `SessionBadge`), assets `avatar-*` and `row-pin` in `apps/Fardesk/Resources/Assets.xcassets`.

```
 ( A )  Title of the chat, one line, tail ellipsis            3h
    (•) State · newest line of the session, up to two     [pin]
        lines, muted
        ----------------------------------------------------  inset divider
```

## Surface

- One white card per machine section, the machine header outside it, rounded corners (the platform's inset-grouped card).
- Inset dividers between rows only: from the title's leading edge to the time's trailing edge. None above the
  first row, none below the last.
- The whole row is one tap target and one VoiceOver button.

## Geometry (points)

| Element | Value |
|---|---|
| Row height | 76 minimum (WhatsApp's pitch), grows with Dynamic Type |
| Avatar | 55 diameter (WhatsApp's size), 13 from the card edge; the mark inside covers about 40 % of the circle |
| Text column | 12 after the avatar; trailing edge 14.5 from the card edge |
| Badge | 24 outer, 3 ring in the card colour, centre +21 / +20 from the avatar centre (mirrored right to left) |
| Pin | 15, trailing on the first preview line |

## Content

| Element | Style |
|---|---|
| Title | 17.5 semibold, primary, one line. The time takes its space first |
| Time | 13.3 regular, secondary, on the title line. Left out while the agent runs (working, in background): it would always say "now" |
| Preview | 14 regular, secondary, up to two lines: the state word, then ` · ` and the newest line (line breaks become spaces). With no line, the state word alone ("Stopped") |
| Pin | `row-pin`, secondary, only on pinned chats |

## Avatar and badge

The avatar names the agent (`AgentKind`): `avatar-claude`, `avatar-codex`. The kit also has Pi and ChatGPT tiles;
they join when those agents do. The avatar never changes with the state; the badge does:

| State | Badge | Colour |
|---|---|---|
| Working | solid, three white dots | green `#297851` |
| In background | pale `#F3FBF6`, green outline, three green dots | green `#297851` |
| Needs you (approval, answer, at the computer) | solid, white "!" | orange `#D9480F` (not in the kit; the attention state) |
| Your turn | solid, white reply arrow | purple `#514A92` |
| Stopped | solid, white square | grey `#737680` |

A colour the user gave the chat (or an automatic colour, when switched on) is a 3 pt ring around the avatar.

## Chat image

A chat can have its own image (Session info, Image: Choose photo, Take photo, Remove image). The row then draws it
in the same 62.5 pt circle (scaled to fill) instead of the agent avatar; the state badge and the colour ring stay
exactly as they are. The label carries a content hash (`label.image`); the app keeps one 192 px square JPEG per
hash in the Caches folder and in memory, fetches it once, and shows the agent avatar until it has loaded.
