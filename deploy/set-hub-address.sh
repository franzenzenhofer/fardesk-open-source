#!/usr/bin/env bash
# Runs ON a member machine: writes the hub's tailnet address (`hubAddress`) into the fardeskd config and restarts the service.
# Usage: FARDESK_LABEL=<bundle prefix>.fardeskd bash set-hub-address.sh <tailnet address of the hub>
# The member then accepts its master token (which the hub holds) from the hub's Tailscale node, and from this computer, nowhere else.
set -euo pipefail
umask 077
HUB_ADDRESS="${1:?usage: set-hub-address.sh <tailnet address of the hub>}"
CONFIG="${FARDESK_CONFIG:-$HOME/.config/fardesk/config.json}"
TMP="$CONFIG.hubaddress.$$"
LABEL="${FARDESK_LABEL:?set FARDESK_LABEL to the launchd label of the daemon (<bundle prefix>.fardeskd)}"

jq --arg address "$HUB_ADDRESS" '.hubAddress = $address' "$CONFIG" > "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$CONFIG"

if [ "$(uname -s)" = "Darwin" ]; then
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
  systemctl --user restart fardeskd.service
fi
jq -r '.hubAddress' "$CONFIG"
