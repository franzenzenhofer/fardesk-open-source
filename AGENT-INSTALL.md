# Install Fardesk with Claude Code

This file is written for a coding agent (Claude Code) and for the person who asked it. A person can follow it
by hand: run the same commands, and do the steps marked HUMAN.

## What the user pastes into Claude Code

```text
Set up Fardesk for me: https://github.com/franzenzenhofer/fardesk-open-source
This is an external open-source repository, so work carefully and precisely. Before you install anything:
clone it, read AGENT-INSTALL.md and every script it runs, do a code review and a security review of what will
run on my computers, and check that it fits my setup. Tell me what you found and wait for my OK.
Then follow AGENT-INSTALL.md and all security best practices. Ask me which of my computers it should cover
and which one is always on.
```

## Before you install: review it (the user asked for this)

This repository is external code for the user. Do not install or run anything from it before these steps:

1. Read this file and every script it will run (`scripts/setup/*.sh`, `deploy/*.sh`, `daemon/fardeskd/package.json`
   scripts, `apps/Fardesk/project.yml`).
2. **Code review:** what each script changes on each machine (files written, services installed, ports opened,
   Claude Code hooks added to `~/.claude/settings.json`).
3. **Security review:** network exposure (the daemon must bind to the Tailscale address only), tokens and where they
   are stored, what the hooks send, what the Coordinator may do, dependencies (`npm audit --omit=dev` in
   `daemon/fardeskd`), and anything that downloads or runs remote code.
4. **Compatibility:** OS versions, Node, Xcode, Tailscale, Claude Code on each of the user's computers; existing
   Claude Code hooks that the install would touch.
5. Report the findings to the user in plain words, with file paths, and wait for their OK before you go on to the next section.

## First, ask the user (before you change anything)

Ask in plain words and wait for the answers. Do not guess.

1. Which computers should Fardesk cover? Offer what you can see: this computer, and the devices in
   `tailscale status`. For each chosen computer ask how you reach it (for example an SSH host name), or whether
   the user will run the install there themselves.
2. Which of them is always on, to be the hub that the phone talks to? "None" is a valid answer: then the phone
   talks to each computer directly.
3. Which computer builds the app (a Mac with Xcode), and does the user have an Apple developer account?
4. Tell the user, in one short paragraph, what stays off by default and why: sessions started from the phone
   keep Claude Code's normal permission prompts, the Coordinator is off, and push text is generic. Turn any of
   them on only if the user asks for it.

Then show the plan (computers, hub, build Mac) and go ahead once the user agrees.

## What you are installing

- `fardeskd`: a daemon (Node) on each computer. Listens on the computer's Tailscale address, port 4780.
- An optional hub: one of the daemons that the phone talks to for all the others.
- The app (iPhone and Mac), built from `apps/Fardesk` with Xcode under the user's own bundle id.

Everything is configured through `fardesk.env` (made from `fardesk.env.example`, ignored by git) and the setup
scripts in `scripts/setup/`. Each script is safe to run again and has a `--check` option that only verifies.

## Requirements (check them, do not install silently)

| Need | Where | How to check |
|---|---|---|
| Tailscale, logged in, on every computer and the phone | all | `tailscale status`, `tailscale ip -4` (an address in 100.64.0.0/10) |
| Node 22 or later | every computer with a daemon | `node --version` |
| Claude Code, logged in | every computer with a daemon | `claude --version`, then a login check by the user |
| macOS with Xcode and XcodeGen | the build computer | `xcodebuild -version`, `xcodegen --version` |
| `jq`, `ssh`, `rsync` | the computer you run this from | `command -v jq ssh rsync` |
| tmux or Ghostty | optional | `command -v tmux` |
| One always-on machine | optional, for a hub | a small Linux server or a Mac that stays awake |

## Rules for the agent

1. Never edit a tracked file. All choices go into `fardesk.env` or a machine's `~/.config/fardesk/config.json`
   (through the setup scripts).
2. Never print a token, a pairing code, a link or a password in the chat or in logs. Show the QR code only on
   the user's own terminal.
3. Tailscale only, no other way: never set `bind.address` to anything but `tailscale` and never list a peer
   outside the tailnet. If the daemon refuses an address, that is the safety check working: stop and report.
4. Do not turn on bypass mode, the Coordinator, full push content or `cross-session accept` unless the user
   asked. Before you do, show the user the risk paragraph from README.md and wait for a yes.
5. At every failed check: stop, report the exact output and what you tried. Do not work around a check.
6. Do not run anything that needs `sudo` without telling the user why.

## Step 0: doctor

Run `bash scripts/setup/00-doctor.sh`. It checks the table above and validates `fardesk.env`.

HUMAN: install Tailscale and log in on every computer and on the phone; log in to Claude Code on every computer.

HUMAN: in the Tailscale admin console (Machines, the "..." menu of each computer), choose **Disable key expiry** for
every computer that runs fardeskd. Tailscale node keys expire after 180 days by default; an expired key logs the
computer out of the tailnet, and Fardesk (Tailscale only) can no longer reach it until someone logs in there again.
Check: `tailscale status --json` shows no `KeyExpiry` for those computers.

Check: the doctor ends with no FAIL line.

## Step 1: configuration

1. `cp fardesk.env.example fardesk.env`.
2. Fill in the machines (`FARDESK_MACHINES`, name and SSH target per machine, `local` for this computer), the
   hub (`FARDESK_HUB`, empty for none), and a bundle prefix the user owns, for example `com.theirname`.
3. Leave `FARDESK_ALLOW_BYPASS=false`, `FARDESK_COORDINATOR=false`, `FARDESK_PUSH_CONTENT=generic`.

Check: `bash scripts/setup/00-doctor.sh --check` passes.

## Step 2: daemons

For each machine: `bash scripts/setup/10-daemon.sh "<machine name>"`. It installs and starts the daemon, writes
the safe defaults into that machine's config and prints the change to `~/.claude/settings.json` that the hooks
need.

HUMAN: read the hook change once and confirm it.

Checks, per machine:
- `fardeskd status` prints `daemon: answers GET /v1/machine`.
- The listening address is the Tailscale address, not `0.0.0.0`: `lsof -iTCP:4780 -sTCP:LISTEN` (macOS) or
  `ss -ltn 'sport = :4780'` (Linux).
- `~/.config/fardesk/config.json` has mode 600.
- `fardeskd homes` lists no `found, not configured` line. Someone who runs Claude Code under `CLAUDE_CONFIG_DIR`
  has more than one Claude home, and the sessions of a home outside `claudeHomes` are invisible. The setup script
  lists the homes it finds; adding one edits its `settings.json`, so ask the user and then run
  `fardeskd homes add <path>` (or `10-daemon.sh` with `--add-homes`). Never add a home on your own.

## Step 3: hub (skip if there is none)

`bash scripts/setup/20-link-hub.sh`. Note for the user: the hub then holds a token for every other machine, so it
is the machine to protect most.

Check: asking the hub for `/v1/hub` lists every machine as online (`bash scripts/setup/90-verify.sh --check` does
this).

## Step 4: the app

`bash scripts/setup/30-app-config.sh` writes `apps/Fardesk/Config/Local.xcconfig` (ignored by git) and generates
the Xcode project. Then `bash scripts/setup/40-app-run.sh`. The file holds only the identity of the build (bundle
prefix, team id): the app has no machine built in, machines come from pairing (Step 5) and their order is set in
the app's settings.

HUMAN: sign in to Xcode with an Apple account, choose the team, connect the iPhone, enable developer mode on it,
and trust the developer certificate on the phone (Settings, General, VPN and Device Management).

Check: `xcodebuild` finishes without error and the app is installed on the phone.

## Step 5: pair the phone

`bash scripts/setup/50-pair.sh` prints a QR code from the hub (or from the one machine, if there is no hub).

HUMAN: open the app and scan the QR code. The pairing window lives 2 minutes, only while the command runs, and takes one device.

Check: `fardeskd devices` on the hub lists the phone, and running `50-pair.sh` again opens a new window with a different code.

## Step 6: optional parts, one at a time, only if the user asks

- Push notifications: `bash scripts/setup/60-apns.sh`. HUMAN: create an APNs key in the Apple developer portal.
  Needs a paid Apple developer account.
- TestFlight: `bash scripts/setup/70-testflight.sh`. HUMAN: create the app record and an App Store Connect API key.
- Bypass mode (`FARDESK_ALLOW_BYPASS=true`), Coordinator (`FARDESK_COORDINATOR=true`), full push content
  (`FARDESK_PUSH_CONTENT=full`): show the risk text, get a yes, rerun `10-daemon.sh`.

## Step 7: verify and report

Run `bash scripts/setup/90-verify.sh`. Report to the user: the machine list, the bind address of each daemon,
which optional parts are on, and how to undo everything:

- `fardeskd uninstall-hooks` on each machine (removes only Fardesk's own entries from `~/.claude/settings.json`)
- remove the service (launchd on macOS, systemd on Linux; the setup script printed the name)
- `fardeskd revoke --all` on each machine

Then check that `git status --porcelain` is empty in the clone (no tracked file was changed).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| macOS asks about incoming connections, or the daemon crashes at start | The Node binary is unsigned. Use `deploy/install-signed-node.sh`. |
| Sessions started by the daemon say "not logged in" | The service does not see your login. Run `claude` once as the same user, then restart the service. |
| Daemon cannot read a folder (Desktop, Documents) | macOS privacy settings: give the daemon's Node binary access in System Settings, Privacy and Security. |
| Typing into a terminal session does nothing | The session is not in tmux or Ghostty. Use Take Over in the app, or start the session in tmux. Ghostty needs the automation permission. |
| `fardeskd` exits with a bind error | The address is not a Tailscale address. Check `tailscale ip -4`; do not work around it. |
| The phone cannot reach the machine | Tailscale must be on and logged in on the phone; check that both are in the same tailnet and that no access rule blocks port 4780. |
