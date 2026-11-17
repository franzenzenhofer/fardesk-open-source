#!/usr/bin/env bash
# Optional: ships the app to your own TestFlight group (scripts/testflight.sh). Needs an App Store Connect app
# record and an API key: ASC_APP_ID, ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, FARDESK_TEAM_ID in fardesk.env.
# --check verifies the key file exists and App Store Connect answers for the app; nothing is uploaded.
# Usage: bash scripts/setup/70-testflight.sh [ios|macos] [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

PLATFORM="${ARGS[0]:-ios}"
fardesk_require ASC_APP_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH FARDESK_TEAM_ID FARDESK_BUNDLE_PREFIX || exit 1
[[ -f "$ASC_KEY_PATH" ]] || die "the key file $ASC_KEY_PATH does not exist"
ok "key file $ASC_KEY_PATH"

if bundle="$(bash "$REPO_ROOT/scripts/asc-env.sh" GET "/v1/apps/$ASC_APP_ID" 2>&1 | jq -r '.data.attributes.bundleId' 2> /dev/null)" && [[ "$bundle" == "$FARDESK_BUNDLE_PREFIX.fardesk" ]]; then
  ok "App Store Connect app $ASC_APP_ID has the bundle id $bundle"
else
  problem "App Store Connect does not return app $ASC_APP_ID with the bundle id $FARDESK_BUNDLE_PREFIX.fardesk (got \"${bundle:-nothing}\")"
fi
[[ "$CHECK_ONLY" -eq 1 || "$FAILED" -ne 0 ]] && setup_finish && exit 0
bash "$REPO_ROOT/scripts/testflight.sh" "$PLATFORM" || die "testflight.sh failed"
changed "build uploaded ($PLATFORM)"
setup_finish
