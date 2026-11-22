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

# The peers the hub should know: every machine but the hub, as [{name, url}]. The url (plain http, Tailscale encrypts the link) holds the machine's tailnet address (100.64.0.0/10), resolved here with `tailscale ip -4` when the host is a name: the daemon accepts no other peer address.
wanted_peers() {
  local name target host address list='[]'
  while IFS='|' read -r name target host; do
    [[ "$name" == "$FARDESK_HUB" ]] && continue
    address="$(fardesk_tailnet_address "${host:-$target}")" || { echo "$name: no tailnet address, not written as a peer" >&2; return 1; }
    list="$(jq -c --arg name "$name" --arg url "http://${address}:$FARDESK_PORT" '. + [{name: $name, url: $url}]' <<< "$list")"
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
  want="$(wanted_peers)" || { problem "could not resolve the tailnet address of every peer"; return; }
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

# The hub's tailnet address: what a member sees as the source of the hub's calls (it asks Tailscale who that is).
hub_address() {
  local name target host
  while IFS='|' read -r name target host; do
    [[ "$name" == "$FARDESK_HUB" ]] || continue
    fardesk_tailnet_address "${host:-$target}"
    return
  done < <(fardesk_machines)
  return 1
}

# set_hub_address NAME TARGET ADDRESS: writes `hubAddress` on a member (deploy/set-hub-address.sh) and restarts its daemon.
set_hub_address() {
  local name="$1" target="$2" address="$3"
  if [[ "$target" == "local" ]]; then
    FARDESK_LABEL="$(fardesk_label)" bash "$REPO_ROOT/deploy/set-hub-address.sh" "$address" > /dev/null || { problem "$name: deploy/set-hub-address.sh failed"; return; }
  else
    scp -q "$REPO_ROOT/deploy/set-hub-address.sh" "$target:.config/fardesk/set-hub-address.sh" || { problem "could not copy set-hub-address.sh to $name"; return; }
    on_machine "$target" "FARDESK_LABEL='$(fardesk_label)' bash ~/.config/fardesk/set-hub-address.sh '$address' > /dev/null" || { problem "$name: set-hub-address.sh failed"; return; }
  fi
  changed "$name hubAddress set to $address"
}

link_hub_address() {
  local want name target have
  want="$(hub_address)" || { problem "could not resolve the tailnet address of the hub"; return; }
  while IFS='|' read -r name target _; do
    [[ "$name" == "$FARDESK_HUB" ]] && continue
    have="$(on_machine "$target" "jq -r '.hubAddress // empty' ~/.config/fardesk/config.json")" || { problem "$name: no config.json (run 10-daemon.sh first)"; continue; }
    if [[ "$have" == "$want" ]]; then ok "$name accepts its master token from the hub $want"; continue; fi
    if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$name hubAddress is ${have:-unset}, want $want"; continue; fi
    set_hub_address "$name" "$target" "$want"
  done < <(fardesk_machines)
}

link_peers
link_tokens
link_hub_address
setup_finish
