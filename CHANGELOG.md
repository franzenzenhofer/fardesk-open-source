# Changelog

All notable changes to Fardesk are in this file. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning 2.0.0](https://semver.org/): a breaking change raises the major number, a new feature the
minor number, a fix the patch number, and every release ships a higher version than the one before.
The daemon, the app and the command-line tool share one version and are updated together.

## [Unreleased]

### Fixed
- The command-line tool says why it cannot reach the daemon (Tailscale down, daemon not running after waiting a few
  seconds for a restart, request timed out, or the daemon's own error code and message) instead of always "no daemon answers" (#97).
- Demo mode: the "Demo" tag no longer floats over the navigation bar and blocks zoom. The notice is content now: the
  first row of the sessions list (with "Leave demo") and a line at the top of the session, new session and Settings
  screens. It grows with Dynamic Type.
- Session row swipes: left to right always starts with Open (a full swipe opens), with Allow or Answer second when the session waits; Pin
  moved to the long-press menu. Right to left shows Deny, Stop and End session. Every swipe button is a solid dark
  fill with a white label and an icon (contrast at least 4.5:1, in light mode, dark mode and Increase Contrast); the
  blank white button is gone.
- Demo mode: what does nothing in the demo (Coordinator, Live Activity pin, notification switches, Add Machine, Delete
  machine, Log Out, the Devices section) is greyed out, decided in one place; what works stays enabled.

## [4.0.0] - 2026-11-21

Breaking: daemon, app and command-line tool must all be 4.0.0, the machine configs change (the `tls` section and the
`pin` of every peer go, peer addresses become `http://`), and every device pairs once more. The owner migration
script does the config change for a whole fleet.

### Security
- Transport security is Tailscale (WireGuard) alone: the daemon listens only on its tailnet address and speaks plain
  HTTP there, and the app, the command-line tool and the hub talk only to `http://` addresses in 100.64.0.0/10.
  Why there is no own certificate any more: since iOS 17, App Transport Security blocks connections to IP addresses and
  refuses a self-signed certificate even with pinning, so the pinned TLS of 3.x could not work on a real phone. The
  apps carry one App Transport Security exception for exactly 100.64.0.0/10 (the app and the widget extension).
- Identity is the Tailscale node: a device token counts only from the node it paired from (Tailscale stable ID, plus
  tags for tagged nodes, never the shared user id), checked with `tailscale whois` on every request and on open
  streams. Another node answers 401 `device_moved` and the app returns to the pairing screen ("This device was paired
  from another Tailscale device. Pair again."); the master token counts only from this computer or the hub's node
  (401 `master_token_wrong_node`); Tailscale not answering is 503 `tailscale_unavailable` (fail closed). The peer
  address is read when the connection opens, so a client that resets keeps its known address.
- Tailscale is mandatory and the pairing screens say so: with Tailscale off, the iPhone shows no scanner, only what to
  do; the Mac app, the command-line tool and `AppModel.pair(link:)` refuse to pair with the same words.
- New gate `scripts/check-ats.sh`: a CLI carrying the apps' exact App Transport Security dictionary pairs with a
  sandbox daemon over plain HTTP.

### Changed
- The pairing link carries no `pin` and a `http://` address; peers in the config are `{ name, url }`; the contract
  version is 3.
- The iPhone pairing screen fits without scrolling: the Tailscale status, the scanner (aspect-fill camera with a
  square target frame) and one instruction line; a camera button at the bottom right of the scanner reads the code from
  a photo. The paste-link field is only on the Mac.

### Removed
- The machine key and certificate, `fardeskd pin`, the certificate pin in pairing links, peers and hub settings, and
  `fardesk hub --pin`. A config that still has `tls` is refused with "remove tls: Fardesk 4 uses Tailscale for encryption".

## [3.1.0] - 2026-11-21

### Added
- `fardeskd pair --show`: the pairing QR code opens as an image on the computer's screen and is never printed, so a
  command run by an agent does not see it; the image is deleted when the pairing window ends.
- The `fardeskd` command is on PATH after an install (`~/.local/bin/fardeskd`, written by the install script).

## [3.0.0] - 2026-11-21

Breaking: daemon and app must both be 3.0.0, and every device pairs once more (scan the code that
`fardeskd pair` shows; with a hub, pair with the hub once).

### Security
- Tailscale only, no other way in: the daemon listens only on its tailnet address, peers must be tailnet addresses,
  and the app and the command-line tool refuse any machine address outside 100.64.0.0/10, also for saved machines.
- Encrypted and pinned: every machine has its own key and certificate; the daemon serves HTTPS only and the app talks
  to a machine only when its key matches the pin from the pairing code.
- No password login any more: devices pair only with a one-time code (two minutes, same tailnet user).

### Added
- The iPhone app scans the pairing QR code on its first screen; pasting a link stays as the second way.
- Colours: 64 presets plus the system colour picker; automatic colour coding (on by default) gives every session a
  colour that stays the same on phone and Mac.
- A session shows which Claude home (account) it belongs to; the list can be filtered by home, and a new session can
  start in a chosen home.
- Demo mode: "See a demo" on the first screen and in Settings shows sample sessions on three pretend machines, so every
  screen (list, session, reply, approve, new session, settings) can be tried without a computer. A "Demo" tag stays on
  screen, nothing in the demo is saved, sent or connected, and leaving it returns to where the app was (the first
  screen on a clean install).

### Changed
- Breaking: the app has no built-in settings any more. The build-time settings for a machine list, a hub and a machine order
  (and the matching app entries in
  `fardesk.env`) are gone. Machines exist only through pairing, so every device is paired again once after the
  update. The machine order is a setting inside the app (Settings, Edit, drag) and stays on the device.
  `FARDESK_BUNDLE_PREFIX` and `FARDESK_TEAM_ID` remain: they are the identity of a build, not of a user.

## [2.1.0] - 2026-11-21

### Added
- Answer a question or a permission request from the phone even after it moved to the computer: the app keeps
  showing it with its options, and a tap types the answer into the terminal dialog where the session can be typed
  into (a single-choice question; allow or deny for a plain permission in tmux).
- Every "needs you" notification names the question or the tool.
- Pairing accepts only a device of the same tailnet user (checked with `tailscale whois`); a pairing code lives two
  minutes, only while `fardeskd pair` runs, and five wrong codes close the window.

### Changed
- A question or permission stays answerable in the app for 15 minutes (was 2) before it moves to the computer;
  the hook timeouts follow the setting.

## [2.0.1] - 2026-11-21

### Fixed
- The daemon no longer waits forever for a tool that hangs: every external command (ps, tailscale, osascript, tmux)
  has a hard deadline, and concurrent reads of the process table share one call. A slow or stuck `ps` used to pile
  up until the computer ran out of processes, and the machine then looked offline in the app.
- Finding Claude homes reads the environment of `claude` processes only, never of other programs.
- Sessions in the system temp folder (tests, scripts) are not listed and send no notifications.
- The session list stays still while you use the app: going back from a chat never reorders it. The freshest
  chats move up when you come back after at least two minutes away, or when you pull to refresh. A session that
  needs you, a new session and pin changes show at once. Opening or switching a chat lands at the newest message.
- Delivery marks: one check for sent, two checks when Claude has the message.

## [2.0.0] - 2026-11-21

### Changed
- Breaking: a session's `waitingFor` can now be `terminal`, a question that is open only at the computer.
  Daemon and app must both be 2.0.0.
- The daemon waits for Tailscale instead of exiting when it is stopped, rebinds when the tailnet address
  changes, and `fardeskd status` says the Tailscale state in plain words.

### Added
- `fardeskd homes` and `fardeskd homes add <path>`: the daemon finds every Claude Code home on the computer
  (including those used through `CLAUDE_CONFIG_DIR`), lists the ones it does not read yet, and adds one without a
  restart.
- An offline machine shows since when it is offline.
- A second notification when a permission question moves from the phone to the computer, replacing the
  first one.
- Issue and pull request templates; CONTRIBUTING explains how outside changes are applied.

### Fixed
- "Needs approval" no longer shows when there is nothing to approve, and a message from the phone is no
  longer held behind it without a reason.
- A permission request answered at the computer, or whose tool call already finished, disappears from the
  phone at once.
- The setup scripts work in the public repository (a shared helper file was missing).

## [1.8.5] - 2026-11-18

Earlier versions: see the commit history of this repository.
