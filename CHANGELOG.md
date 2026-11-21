# Changelog

All notable changes to Fardesk are in this file. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and the versions follow
[Semantic Versioning 2.0.0](https://semver.org/): a breaking change raises the major number, a new feature the
minor number, a fix the patch number, and every release ships a higher version than the one before.
The daemon, the app and the command-line tool share one version and are updated together.

## [Unreleased]

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
