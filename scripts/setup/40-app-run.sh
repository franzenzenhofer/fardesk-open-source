#!/usr/bin/env bash
# Gets the app onto a device. Without arguments it opens the project in Xcode (choose your device and press Run).
# With --device <id> it builds for that connected device and installs it (list ids with: xcrun devicectl list devices).
# --check verifies the project is generated, a team is set and, with --device, that the device is connected.
# Usage: bash scripts/setup/40-app-run.sh [--device <id>] [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_BUNDLE_PREFIX || exit 1
APP_DIR="$REPO_ROOT/apps/Fardesk"
PROJECT="$APP_DIR/Fardesk.xcodeproj"
DEVICE=""
if [[ "${ARGS[0]:-}" == "--device" ]]; then DEVICE="${ARGS[1]:-}"; [[ -n "$DEVICE" ]] || die "--device needs an id"; fi

check_project() {
  if [[ -d "$PROJECT" ]]; then ok "Fardesk.xcodeproj exists"; else problem "no Fardesk.xcodeproj: run scripts/setup/30-app-config.sh first"; fi
  if [[ -n "${FARDESK_TEAM_ID:-}" ]]; then ok "team id $FARDESK_TEAM_ID"; else say "skipped  FARDESK_TEAM_ID is empty: Xcode asks for the team when you press Run"; fi
  [[ -z "$DEVICE" ]] && return
  if xcrun devicectl list devices 2> /dev/null | grep -q "$DEVICE"; then ok "device $DEVICE is known"; else problem "device $DEVICE is not connected"; fi
}

install_on_device() {
  local derived="$APP_DIR/build/device"
  xcodebuild -project "$PROJECT" -scheme Fardesk -destination "id=$DEVICE" -derivedDataPath "$derived" \
    -allowProvisioningUpdates FARDESK_BUNDLE_PREFIX="$FARDESK_BUNDLE_PREFIX" FARDESK_TEAM_ID="${FARDESK_TEAM_ID:-}" -quiet build \
    || die "build for the device failed"
  xcrun devicectl device install app --device "$DEVICE" "$derived/Build/Products/Debug-iphoneos/Fardesk.app" || die "install failed"
  changed "Fardesk installed on $DEVICE"
}

check_project
[[ "$CHECK_ONLY" -eq 1 || "$FAILED" -ne 0 ]] && setup_finish && exit 0
if [[ -n "$DEVICE" ]]; then install_on_device; else open "$PROJECT"; changed "opened the project in Xcode"; fi
setup_finish
