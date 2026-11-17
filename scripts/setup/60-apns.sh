#!/usr/bin/env bash
# Optional: installs the APNs key for push notifications on the hub (deploy/set-apns.sh). Needs a paid Apple
# developer account and the key from the developer portal: FARDESK_APNS_KEY_PATH and FARDESK_APNS_KEY_ID.
# Usage: bash scripts/setup/60-apns.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_BUNDLE_PREFIX FARDESK_TEAM_ID FARDESK_APNS_KEY_PATH FARDESK_APNS_KEY_ID FARDESK_MACHINES || exit 1
[[ -f "$FARDESK_APNS_KEY_PATH" ]] || die "the key file $FARDESK_APNS_KEY_PATH does not exist"
NAME="${FARDESK_HUB:-$(fardesk_machines | head -1 | cut -d'|' -f1)}"
TARGET="$(machine_target "$NAME")"
TOPIC="$FARDESK_BUNDLE_PREFIX.fardesk"

have="$(daemon_config_value "$TARGET" '.apns | if . == null then "none" else "\(.keyId) \(.teamId) \(.topic)" end' 2> /dev/null)"
want="$FARDESK_APNS_KEY_ID $FARDESK_TEAM_ID $TOPIC"
if [[ "$have" == "$want" ]]; then ok "$NAME: apns is $want"; setup_finish; exit 0; fi
if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$NAME: apns is \"$have\", want \"$want\""; setup_finish; exit 0; fi
bash "$REPO_ROOT/deploy/set-apns.sh" "$TARGET" > /dev/null || die "deploy/set-apns.sh failed"
changed "$NAME: apns key $FARDESK_APNS_KEY_ID installed, daemon restarted"
setup_finish
