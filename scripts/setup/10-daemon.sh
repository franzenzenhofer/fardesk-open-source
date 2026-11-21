#!/usr/bin/env bash
# Installs the daemon on one machine of FARDESK_MACHINES and writes the safety settings of fardesk.env into that
# machine's config.json: owned.allowBypass, coordinator (on the hub only), push.content and hub.enabled.
# The Claude Code hooks are installed only with --approve-hooks; without it the diff is shown and the script stops.
# Other Claude homes on the machine (CLAUDE_CONFIG_DIR) are listed; --add-homes adds them to claudeHomes.
# Usage: bash scripts/setup/10-daemon.sh <machine name> [--approve-hooks] [--add-homes] [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

APPROVE_HOOKS=0
ADD_HOMES=0
NAME=""
for arg in ${ARGS[@]+"${ARGS[@]}"}; do
  case "$arg" in
    --approve-hooks) APPROVE_HOOKS=1 ;;
    --add-homes) ADD_HOMES=1 ;;
    *) NAME="$arg" ;;
  esac
done
[[ -n "$NAME" ]] || die "usage: 10-daemon.sh <machine name> [--approve-hooks] [--add-homes] [--check]"
fardesk_require FARDESK_BUNDLE_PREFIX FARDESK_MACHINES || exit 1
TARGET="$(machine_target "$NAME")"
IS_HUB=false
[[ "${FARDESK_HUB:-}" == "$NAME" ]] && IS_HUB=true

flag() { # variable name, default: a validated true|false
  local value="${!1:-$2}"
  [[ "$value" == "true" || "$value" == "false" ]] || die "$1 must be true or false, got \"$value\""
  printf '%s\n' "$value"
}

# What this machine's config.json should say, as JSON.
wanted() {
  local coordinator=false full_tools=false
  if [[ "$IS_HUB" == "true" ]]; then coordinator="$(flag FARDESK_COORDINATOR false)"; full_tools="$(flag FARDESK_COORDINATOR_FULL_TOOLS false)"; fi
  local content="${FARDESK_PUSH_CONTENT:-generic}"
  [[ "$content" == "generic" || "$content" == "full" ]] || die "FARDESK_PUSH_CONTENT must be generic or full, got \"$content\""
  jq -nc --argjson bypass "$(flag FARDESK_ALLOW_BYPASS false)" --argjson coordinator "$coordinator" \
    --argjson fullTools "$full_tools" --arg content "$content" --argjson hub "$IS_HUB" \
    '{allowBypass: $bypass, coordinatorEnabled: $coordinator, fullTools: $fullTools, pushContent: $content, hubEnabled: $hub}'
}

current() {
  on_machine "$TARGET" "jq -c '{allowBypass: (.owned.allowBypass // false), coordinatorEnabled: (.coordinator.enabled // false), fullTools: (.coordinator.fullTools // false), pushContent: (.push.content // \"generic\"), hubEnabled: (.hub.enabled // false)}' ~/.config/fardesk/config.json"
}

restart_command() {
  printf '%s' 'if [ "$(uname -s)" = "Darwin" ]; then launchctl kickstart -k "gui/$(id -u)/'"$(fardesk_label)"'"; else systemctl --user restart fardeskd.service; fi'
}

apply_config() {
  local want="$1" stamp filter
  stamp="$(date +%Y%m%d-%H%M%S)"
  filter="$(jq -nr --argjson w "$want" '".owned.allowBypass = \($w.allowBypass) | .coordinator.enabled = \($w.coordinatorEnabled) | .coordinator.fullTools = \($w.fullTools) | .push.content = \"\($w.pushContent)\" | .hub.enabled = \($w.hubEnabled)"')"
  on_machine "$TARGET" "cfg=~/.config/fardesk/config.json; cp \$cfg \$cfg.bak-$stamp && jq '$filter' \$cfg > \$cfg.new && chmod 600 \$cfg.new && mv \$cfg.new \$cfg && $(restart_command)"
  changed "$NAME: config.json updated (backup config.json.bak-$stamp), daemon restarted"
}

sync_config() {
  local want have
  want="$(wanted)"
  have="$(current)" || { problem "$NAME: no config.json yet (run this script without --check first)"; return; }
  if [[ "$(jq -S . <<< "$want")" == "$(jq -S . <<< "$have")" ]]; then ok "$NAME: config.json has $want"; return; fi
  if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$NAME: config.json has $have, fardesk.env wants $want"; return; fi
  apply_config "$want"
}

hooks_step() {
  local diff
  diff="$(fardeskd "$TARGET" install-hooks --dry-run 2>&1)" || { problem "$NAME: install-hooks --dry-run failed: $diff"; return; }
  if ! grep -q "would change" <<< "$diff"; then ok "$NAME: Claude Code hooks are installed"; return; fi
  say "$diff"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$NAME: hooks not installed"; return; fi
  if [[ "$APPROVE_HOOKS" -eq 0 ]]; then
    say "The hooks above are not installed yet. Read the diff, then run again with --approve-hooks."
    FAILED=1
    return
  fi
  fardeskd "$TARGET" install-hooks > /dev/null
  changed "$NAME: Claude Code hooks installed"
}

# Claude homes on the machine that the daemon does not read. Adding one edits its settings.json, so it is never silent:
# the homes are listed once, and only --add-homes adds them (same backup and diff as the hooks).
homes_step() {
  local listing found line path added
  listing="$(fardeskd "$TARGET" homes 2>&1)" || { problem "$NAME: Claude homes check could not run: ${listing}"; return; }
  found="$(grep '^found, not configured' <<< "$listing")" || { ok "$NAME: no Claude home outside claudeHomes"; return; }
  say "$found"
  if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$NAME: Claude homes found that claudeHomes does not list"; return; fi
  if [[ "$ADD_HOMES" -eq 0 ]]; then
    say "Sessions in these homes are invisible. Run again with --add-homes to add them all, or add one: fardeskd homes add <path>."
    return
  fi
  # Each line ends with ": fardeskd homes add <path>", so the path is everything after that marker, spaces included.
  while IFS= read -r line; do
    path="${line#*: fardeskd homes add }"
    if [[ "$path" == "$line" || -z "$path" ]]; then problem "$NAME: cannot read a Claude home path from: ${line}"; continue; fi
    if added="$(fardeskd "$TARGET" homes add "$path" 2>&1)"; then changed "$NAME: Claude home $path added"; else problem "$NAME: Claude home $path could not be added: ${added}"; fi
  done <<< "$found"
}

if [[ "$CHECK_ONLY" -eq 0 ]]; then
  FARDESK_SKIP_HOOKS=1 bash "$REPO_ROOT/deploy/deploy.sh" "$TARGET" "$NAME" || die "deploy to $NAME failed"
  changed "$NAME: daemon deployed"
fi
sync_config
hooks_step
homes_step
setup_finish
