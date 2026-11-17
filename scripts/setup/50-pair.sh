#!/usr/bin/env bash
# Shows the pairing QR code of the hub (or of the one machine when there is no hub). Scan it in the app.
# The code is printed to this terminal only. --check verifies the daemon answers on that machine.
# Usage: bash scripts/setup/50-pair.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_MACHINES || exit 1
NAME="${FARDESK_HUB:-}"
if [[ -z "$NAME" ]]; then
  NAME="$(fardesk_machines | head -1 | cut -d'|' -f1)"
  [[ "$(fardesk_machines | wc -l | tr -d ' ')" -eq 1 ]] || die "no FARDESK_HUB and several machines: pair with each machine by hand, name one in FARDESK_HUB"
fi
TARGET="$(machine_target "$NAME")"

if status="$(fardeskd "$TARGET" status 2>&1)" && grep -q "daemon: answers" <<< "$status"; then
  ok "$NAME: the daemon answers"
else
  problem "$NAME: the daemon does not answer (run scripts/setup/10-daemon.sh \"$NAME\")"
fi
[[ "$CHECK_ONLY" -eq 1 || "$FAILED" -ne 0 ]] && setup_finish && exit 0
say "Scan this in the Fardesk app (Settings, Add machine):"
fardeskd "$TARGET" pair || die "fardeskd pair failed on $NAME"
setup_finish
