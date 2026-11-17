#!/usr/bin/env bash
# Links the other machines to the hub: writes `peers` (name and URL of every other machine) into the hub's
# config.json and gives the hub the peer tokens (deploy/set-hub-peers.sh). Does nothing without FARDESK_HUB.
# Usage: bash scripts/setup/20-link-hub.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_MACHINES FARDESK_PORT || exit 1
if [[ -z "${FARDESK_HUB:-}" ]]; then say "no FARDESK_HUB: the phone pairs with each machine, nothing to link"; setup_finish; exit 0; fi
HUB_TARGET="$(machine_target "$FARDESK_HUB")"
[[ "$HUB_TARGET" != "local" ]] || die "the hub is reached over ssh: run this script on another machine, or give the hub an ssh target"

# The peers the hub should know: every machine but the hub, as [{name, url}].
wanted_peers() {
  local name target host list='[]'
  while IFS='|' read -r name target host; do
    [[ "$name" == "$FARDESK_HUB" ]] && continue
    list="$(jq -c --arg name "$name" --arg url "http://${host:-$target}:$FARDESK_PORT" '. + [{name: $name, url: $url}]' <<< "$list")"
  done < <(fardesk_machines)
  jq -cS 'sort_by(.name)' <<< "$list"
}

hub_peers() {
  on_machine "$HUB_TARGET" "jq -cS '(.peers // []) | sort_by(.name)' ~/.config/fardesk/config.json"
}

hub_peer_token_names() {
  on_machine "$HUB_TARGET" "jq -cS '(.coordinator.peerTokens // {}) | keys' ~/.config/fardesk/config.json"
}

wanted_token_names() {
  local name list='[]'
  while IFS='|' read -r name _; do
    [[ "$name" == "$FARDESK_HUB" ]] || list="$(jq -c --arg n "$name" '. + [$n]' <<< "$list")"
  done < <(fardesk_machines)
  jq -cS 'sort' <<< "$list"
}

link_peers() {
  local want have
  want="$(wanted_peers)"
  have="$(hub_peers)" || { problem "hub $FARDESK_HUB: no config.json (run 10-daemon.sh first)"; return; }
  if [[ "$have" == "$want" ]]; then ok "hub peers: $want"; return; fi
  if [[ "$CHECK_ONLY" -eq 1 ]]; then would "hub peers are $have, want $want"; return; fi
  scp -q "$REPO_ROOT/deploy/set-peers.sh" "$HUB_TARGET:.config/fardesk/set-peers.sh" || { problem "could not copy set-peers.sh to the hub"; return; }
  on_machine "$HUB_TARGET" "FARDESK_LABEL='$(fardesk_label)' bash ~/.config/fardesk/set-peers.sh '$want' > /dev/null"
  changed "hub peers set to $want"
}

link_tokens() {
  local want have
  want="$(wanted_token_names)"
  have="$(hub_peer_token_names)" || { problem "hub $FARDESK_HUB: no config.json"; return; }
  if [[ "$have" == "$want" ]]; then ok "hub holds tokens for $want"; return; fi
  if [[ "$CHECK_ONLY" -eq 1 ]]; then would "hub holds tokens for $have, want $want"; return; fi
  bash "$REPO_ROOT/deploy/set-hub-peers.sh" > /dev/null || { problem "deploy/set-hub-peers.sh failed"; return; }
  changed "hub peer tokens written for $want"
}

link_peers
link_tokens
setup_finish
