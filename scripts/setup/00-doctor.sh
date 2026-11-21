#!/usr/bin/env bash
# Checks this computer and fardesk.env before anything is installed. Changes nothing (--check is accepted and
# means the same). Usage: bash scripts/setup/00-doctor.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

MIN_NODE_MAJOR=22

need_tool() { # command, why
  if command -v "$1" > /dev/null 2>&1; then ok "$1 found"; else problem "$1 is missing ($2)"; fi
}

optional_tool() { # command, why
  if command -v "$1" > /dev/null 2>&1; then ok "$1 found"; else say "skipped  $1 not found ($2)"; fi
}

check_node() {
  command -v node > /dev/null 2>&1 || { problem "node is missing (the daemon runs on it)"; return; }
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -ge "$MIN_NODE_MAJOR" ]]; then ok "node $(node --version)"; else problem "node $(node --version) is too old, need $MIN_NODE_MAJOR or newer"; fi
}

check_claude_and_tailscale() {
  if claude --version > /dev/null 2>&1; then ok "claude $(claude --version 2>&1 | head -1)"; else problem "claude is missing or not working (install Claude Code and log in)"; fi
  if tailscale status > /dev/null 2>&1; then ok "tailscale is up"; else problem "tailscale is not running or not logged in"; fi
}

check_apple_tools() {
  [[ "$(uname -s)" == "Darwin" ]] || { say "skipped  Xcode and xcodegen (the app is built on a Mac)"; return; }
  if xcodebuild -version > /dev/null 2>&1; then ok "$(xcodebuild -version | head -1)"; else problem "Xcode is missing (needed for the iPhone/Mac app)"; fi
  need_tool xcodegen "brew install xcodegen"
  if [[ -d /Applications/Ghostty.app ]]; then ok "Ghostty found"; else say "skipped  Ghostty not found (only /clear and /compact in a terminal need it)"; fi
}

check_env_file() {
  local file
  file="$(fardesk_env_file)"
  [[ -f "$file" ]] || { problem "$file does not exist: copy fardesk.env.example to fardesk.env and fill it in"; return; }
  ok "$file exists"
  fardesk_require FARDESK_BUNDLE_PREFIX FARDESK_MACHINES FARDESK_PORT || { FAILED=1; return; }
  check_machines
  check_choice FARDESK_PUSH_CONTENT "${FARDESK_PUSH_CONTENT:-generic}" generic full
  local flag
  for flag in FARDESK_ALLOW_BYPASS FARDESK_COORDINATOR FARDESK_COORDINATOR_FULL_TOOLS; do
    check_choice "$flag" "${!flag:-false}" true false
  done
}

check_choice() { # name value allowed...
  local name="$1" value="$2" allowed
  shift 2
  for allowed in "$@"; do
    if [[ "$value" == "$allowed" ]]; then ok "$name=$value"; return; fi
  done
  problem "$name=$value, allowed: $*"
}

check_machines() {
  local name target names=()
  while IFS='|' read -r name target _; do
    if [[ -z "$name" || -z "$target" ]]; then problem "FARDESK_MACHINES entry without a name or ssh target"; continue; fi
    names+=("$name")
  done < <(fardesk_machines)
  ok "${#names[@]} machines in FARDESK_MACHINES"
  if [[ -n "${FARDESK_HUB:-}" ]] && ! printf '%s\n' "${names[@]}" | grep -qxF "$FARDESK_HUB"; then
    problem "FARDESK_HUB=\"$FARDESK_HUB\" is not a machine name"
  fi
}

# Claude homes on this computer that the installed daemon does not read yet (their sessions would be invisible).
check_claude_homes() {
  local main="$HOME/.local/share/fardeskd/dist/main.js" found
  [[ -f "$main" ]] || { say "skipped  Claude homes (the daemon is not installed on this computer yet)"; return; }
  local listing
  listing="$(node "$main" homes 2>&1)" || { say "skipped  Claude homes (the check could not run: ${listing})"; return; }
  found="$(grep '^found, not configured' <<< "$listing")" || { ok "no Claude home outside claudeHomes"; return; }
  while IFS= read -r line; do say "note     ${line}"; done <<< "$found"
}

check_node
need_tool jq "brew install jq / apt install jq"
need_tool ssh "needed to reach the other machines"
optional_tool tmux "needed for the Stop command on sessions started in a terminal"
check_claude_and_tailscale
check_apple_tools
check_claude_homes
check_env_file
setup_finish
