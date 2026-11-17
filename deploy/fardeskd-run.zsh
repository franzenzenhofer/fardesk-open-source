#!/bin/zsh
# launchd entry point for fardeskd on macOS. zsh reads ~/.zshenv before this script runs, so the
# daemon and the Claude sessions it starts get the same environment as a login shell (for example
# CLAUDE_CODE_OAUTH_TOKEN on machines whose keychain login is not used). No secret lives in the plist.
# Usage (from the LaunchAgent): fardeskd-run.zsh <node binary> <main.js>
exec "$1" "$2" serve
