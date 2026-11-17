#!/usr/bin/env bash
# Runs scripts/asc.mjs with the App Store Connect API key identifiers from the environment or fardesk.env.
# The .p8 itself lives outside the repo. Nothing has a default: a missing value stops the script.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$SCRIPT_DIR/lib/fardesk-env.sh"
fardesk_load_env
fardesk_require ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH || exit 1
export ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH
exec node "$SCRIPT_DIR/asc.mjs" "$@"
