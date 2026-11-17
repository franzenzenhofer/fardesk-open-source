#!/usr/bin/env bash
# Runs ON a machine: writes the peer list into the fardeskd config and restarts the service.
# Usage: FARDESK_LABEL=<bundle prefix>.fardeskd bash set-peers.sh '<json array of {name,url}>'
# The peer list lets a client that knows one machine find the others after login.
set -euo pipefail
PEERS_JSON="${1:?usage: set-peers.sh '<json array of {name,url}>'}"
CONFIG="${FARDESK_CONFIG:-$HOME/.config/fardesk/config.json}"
TMP="$CONFIG.peers.$$"
LABEL="${FARDESK_LABEL:?set FARDESK_LABEL to the launchd label of the daemon (<bundle prefix>.fardeskd)}"

jq --argjson peers "$PEERS_JSON" '.peers = $peers' "$CONFIG" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$CONFIG"

if [ "$(uname -s)" = "Darwin" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  systemctl --user restart fardeskd.service
fi
jq -c '.peers' "$CONFIG"
