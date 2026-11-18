#!/usr/bin/env bash
# Installs the APNs key and settings for fardeskd on one machine and restarts the service.
# Usage: bash deploy/set-apns.sh <ssh-host|local> [<path to AuthKey_XXXX.p8> <key id> <team id> <topic>]
# Missing arguments come from fardesk.env: FARDESK_APNS_KEY_PATH, FARDESK_APNS_KEY_ID, FARDESK_TEAM_ID, <prefix>.fardesk.
# The key is copied to ~/.config/fardesk/ on the target (mode 600). It never enters the repo.
set -euo pipefail
umask 077
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/fardesk-env.sh"
fardesk_load_env
fardesk_require FARDESK_BUNDLE_PREFIX
LABEL="$(fardesk_label)"
TARGET="${1:?target}"
KEY_FILE="${2:-${FARDESK_APNS_KEY_PATH:?key file (argument 2 or FARDESK_APNS_KEY_PATH)}}"
KEY_ID="${3:-${FARDESK_APNS_KEY_ID:?key id (argument 3 or FARDESK_APNS_KEY_ID)}}"
TEAM_ID="${4:-${FARDESK_TEAM_ID:?team id (argument 4 or FARDESK_TEAM_ID)}}"
TOPIC="${5:-$FARDESK_BUNDLE_PREFIX.fardesk}"
KEY_NAME="$(basename "$KEY_FILE")"
REMOTE_SCRIPT='set -euo pipefail
umask 077
CONFIG="$HOME/.config/fardesk/config.json"
chmod 600 "$HOME/.config/fardesk/'"$KEY_NAME"'"
TMP="$CONFIG.apns.$$"
jq --arg key "~/.config/fardesk/'"$KEY_NAME"'" --arg id "'"$KEY_ID"'" --arg team "'"$TEAM_ID"'" --arg topic "'"$TOPIC"'" \
  ".apns = {keyPath: \$key, keyId: \$id, teamId: \$team, topic: \$topic}" "$CONFIG" > "$TMP"
chmod 600 "$TMP"; mv "$TMP" "$CONFIG"
if [ "$(uname -s)" = "Darwin" ]; then launchctl kickstart -k "gui/$(id -u)/'"$LABEL"'"; else systemctl --user restart fardeskd.service; fi
sleep 2
jq -c ".apns | {keyId, teamId, topic}" "$CONFIG"'

STEP="$(mktemp)"
printf '%s\n' "$REMOTE_SCRIPT" > "$STEP"
if [ "$TARGET" = "local" ]; then
  cp "$KEY_FILE" "$HOME/.config/fardesk/$KEY_NAME"
  bash "$STEP"
else
  scp -q "$KEY_FILE" "$TARGET:.config/fardesk/$KEY_NAME"
  scp -q "$STEP" "$TARGET:.config/fardesk/set-apns-step.sh"
  ssh "$TARGET" 'bash -l ~/.config/fardesk/set-apns-step.sh'
fi
