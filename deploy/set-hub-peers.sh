#!/usr/bin/env bash
# Gives the hub machine the tokens of the other machines, so the hub and the coordinator can call them: writes
# coordinator.peerTokens on the hub (timestamped backup of the config next to it).
# Usage: bash deploy/set-hub-peers.sh [<hub ssh target|local> <peer name>=<ssh target|local> ...]
# Without arguments the hub is FARDESK_HUB and the peers are the other machines of FARDESK_MACHINES (fardesk.env).
# Example: bash deploy/set-hub-peers.sh build-server "Studio=local" "Laptop=laptop"
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/fardesk-env.sh"
fardesk_load_env

# The remote shell expands the tilde.
# shellcheck disable=SC2088
CFG='~/.config/fardesk/config.json'
STAMP=$(date +%Y%m%d-%H%M%S)
WORK=$(mktemp -d)

default_arguments() {
  fardesk_require FARDESK_HUB FARDESK_MACHINES
  local name target
  HUB="$(fardesk_machine_target "$FARDESK_HUB")"
  PEERS=()
  while IFS='|' read -r name target _; do
    if [ "$name" != "$FARDESK_HUB" ]; then PEERS+=("$name=$target"); fi
  done < <(fardesk_machines)
}

if [ "$#" -gt 0 ]; then
  HUB="$1"
  shift
  PEERS=("$@")
else
  default_arguments
fi
if [ "$HUB" = "local" ]; then
  echo "the hub must be reached over ssh: run this script from another machine or give the hub an ssh target" >&2
  exit 1
fi
[ "${#PEERS[@]}" -gt 0 ] || { echo "no peers: the hub has nothing to link" >&2; exit 1; }

peer_token() { # ssh target or local
  if [ "$1" = "local" ]; then jq -r .token ~/.config/fardesk/config.json; else ssh "$1" "jq -r .token $CFG"; fi
}

echo '{}' > "$WORK/tokens.json"
for peer in "${PEERS[@]}"; do
  name="${peer%%=*}"
  peer_token "${peer#*=}" > "$WORK/token"
  jq --arg name "$name" --rawfile token "$WORK/token" '. + {($name): ($token | rtrimstr("\n"))}' "$WORK/tokens.json" > "$WORK/tokens.next"
  mv "$WORK/tokens.next" "$WORK/tokens.json"
done

scp -q "$WORK/tokens.json" "$HUB:.config/fardesk/peer-tokens.json"
ssh "$HUB" "umask 077 && cp $CFG $CFG.bak-$STAMP && jq --slurpfile t ~/.config/fardesk/peer-tokens.json '.coordinator = ((.coordinator // {}) + {peerTokens: \$t[0]})' $CFG > $CFG.new && mv $CFG.new $CFG && chmod 600 $CFG && mv ~/.config/fardesk/peer-tokens.json ~/.config/fardesk/peer-tokens.json.applied-$STAMP && jq -c '.coordinator.peerTokens|keys' $CFG"
mv "$WORK" "$HOME/.Trash/fardesk-hub-peers-$STAMP"
