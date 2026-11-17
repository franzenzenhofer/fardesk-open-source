#!/usr/bin/env bash
# Verifies the whole setup, read only: on every machine of FARDESK_MACHINES the daemon answers, config.json is mode
# 600, the bind address is a tailnet address (or loopback), and the safety settings match fardesk.env; the hub
# answers GET /v1/hub. Prints the bypass and Coordinator state of each machine. --check is accepted (same thing).
# Usage: bash scripts/setup/90-verify.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_MACHINES FARDESK_PORT || exit 1
TAILNET_ADDRESS='^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+$'

verify_machine() { # name target
  local name="$1" target="$2" status mode bind
  if status="$(fardeskd "$target" status 2>&1)" && grep -q "daemon: answers" <<< "$status"; then ok "$name: the daemon answers"; else problem "$name: the daemon does not answer"; return; fi
  mode="$(on_machine "$target" 'stat -c %a ~/.config/fardesk/config.json 2>/dev/null || stat -f %Lp ~/.config/fardesk/config.json')"
  if [[ "$mode" == "600" ]]; then ok "$name: config.json mode 600"; else problem "$name: config.json mode is $mode, want 600"; fi
  bind="$(daemon_config_value "$target" '.bind.address')"
  if [[ "$bind" == "tailscale" || "$bind" == "127.0.0.1" || "$bind" =~ $TAILNET_ADDRESS ]]; then ok "$name: bind address $bind"; else problem "$name: bind address $bind is not a tailnet address"; fi
  say "         $name: bypass=$(daemon_config_value "$target" '.owned.allowBypass // false') coordinator=$(daemon_config_value "$target" '.coordinator.enabled // false') push=$(daemon_config_value "$target" '.push.content // "generic"')"
}

verify_hub() {
  [[ -n "${FARDESK_HUB:-}" ]] || { say "skipped  no FARDESK_HUB"; return; }
  local target answer
  target="$(machine_target "$FARDESK_HUB")"
  answer="$(on_machine "$target" 'cfg=~/.config/fardesk/config.json; addr=$(jq -r .bind.address $cfg); if [ "$addr" = tailscale ]; then addr=$(tailscale ip -4 | head -1); fi; curl -s -m 8 -H "Authorization: Bearer $(jq -r .token $cfg)" "http://$addr:'"$FARDESK_PORT"'/v1/hub" | jq -c "{hub, machines: [.machines[].name]}"' 2>&1)"
  if jq -e '.hub' > /dev/null 2>&1 <<< "$answer"; then ok "hub answers GET /v1/hub: $answer"; else problem "hub does not answer GET /v1/hub: $answer"; fi
}

while IFS='|' read -r name target _; do verify_machine "$name" "$target"; done < <(fardesk_machines)
verify_hub
setup_finish
