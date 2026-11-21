#!/usr/bin/env bash
# Usage: scripts/testflight.sh [ios|macos]   (default ios; macos ships the Mac app through TestFlight for Mac)
# Ships the Fardesk app to the internal TestFlight group: archive, upload, wait for processing,
# make sure the internal group and its tester exist. Never submits for review, no external testers.
# Resumable: after a successful upload the build number is stored in $FARDESK_BUILD_DIR/pending-build;
# a re-run skips archive and upload and continues polling.
set -euo pipefail
# Build output must stay world-readable: App Store Connect refuses a macOS installer package with files only the
# owner can read ("only readable by the root user", 409). Secret files are written with explicit modes below.
umask 022

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$REPO_ROOT/apps/Fardesk"
GROUP_NAME="Fardesk Internal"
POLL_SECONDS=30
POLL_LIMIT=60

# The App Store Connect ids come from the environment or fardesk.env; nothing has a default.
. "$SCRIPT_DIR/lib/fardesk-env.sh"
fardesk_load_env
fardesk_require ASC_APP_ID ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH FARDESK_TEAM_ID FARDESK_BUNDLE_PREFIX || exit 1
APP_ID="$ASC_APP_ID"
TEAM_ID="$FARDESK_TEAM_ID"
export ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH
BUILD_DIR="${FARDESK_BUILD_DIR:-${TMPDIR:-/tmp}/fardesk-build}"
BUILD_DIR="${BUILD_DIR%/}"

PLATFORM="${1:-ios}"
case "$PLATFORM" in
  ios) ARCHIVE_DESTINATION='generic/platform=iOS'; ASC_PLATFORM=IOS; ALTOOL_PLATFORM=ios ;;
  macos) ARCHIVE_DESTINATION='generic/platform=macOS'; ASC_PLATFORM=MAC_OS; ALTOOL_PLATFORM=macos ;;
  *) printf '[testflight] ERROR: platform must be ios or macos, got %s\n' "$PLATFORM" >&2; exit 1 ;;
esac
PENDING_FILE="$BUILD_DIR/pending-build-$PLATFORM"

log() { printf '[testflight] %s\n' "$*"; }
die() { printf '[testflight] ERROR: %s\n' "$*" >&2; exit 1; }

# asc METHOD PATH [BODY_FILE]: prints the JSON response, shows the error body on failure.
asc() {
  local out
  if ! out="$(bash "$SCRIPT_DIR/asc-env.sh" "$@" 2>&1)"; then
    printf '%s\n' "$out" >&2
    die "ASC API call failed: $1 $2"
  fi
  printf '%s\n' "$out"
}

auth_flags() {
  AUTH_FLAGS=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY_PATH"
    -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
}

next_build_number() {
  local current
  current="$(asc GET "/v1/builds?filter%5Bapp%5D=$APP_ID&limit=200" \
    | jq '[.data[].attributes.version | tonumber] | max // 0')"
  echo $((current + 1))
}

write_export_options() {
  local plist="$BUILD_DIR/ExportOptions.plist"
  printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
    '<plist version="1.0"><dict>' \
    '<key>method</key><string>app-store-connect</string>' \
    '<key>destination</key><string>export</string>' \
    "<key>teamID</key><string>$TEAM_ID</string>" \
    '<key>signingStyle</key><string>automatic</string>' \
    '<key>manageAppVersionAndBuildNumber</key><false/>' \
    '<key>uploadSymbols</key><true/>' \
    '</dict></plist>' > "$plist"
  plutil -lint "$plist" > /dev/null
}

archive_app() {
  local number="$1"
  log "generating project and archiving $PLATFORM build $number"
  (cd "$APP_DIR" && xcodegen generate) > "$BUILD_DIR/xcodegen.log" 2>&1
  xcodebuild archive -project "$APP_DIR/Fardesk.xcodeproj" -scheme Fardesk \
    -destination "$ARCHIVE_DESTINATION" -archivePath "$BUILD_DIR/Fardesk-$number.xcarchive" \
    CURRENT_PROJECT_VERSION="$number" FARDESK_BUNDLE_PREFIX="$FARDESK_BUNDLE_PREFIX" FARDESK_TEAM_ID="$FARDESK_TEAM_ID" "${AUTH_FLAGS[@]}" > "$BUILD_DIR/archive.log" 2>&1 \
    || { tail -40 "$BUILD_DIR/archive.log" >&2; die "archive failed, see $BUILD_DIR/archive.log"; }
}

# Export to a local file, then upload it with altool. Xcode's own upload first asks App Store Connect for the
# app's versions with a query that answered HTTP 500 for this app on 2026-11-17 (UNEXPECTED_ERROR), while
# altool's upload does not depend on it.
export_and_upload() {
  local number="$1" package
  log "exporting and uploading build $number"
  write_export_options
  # Xcode shells out to rsync -E; Homebrew's rsync earlier in PATH rejects that flag ("Copy failed").
  PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH" xcodebuild -exportArchive -archivePath "$BUILD_DIR/Fardesk-$number.xcarchive" \
    -exportPath "$BUILD_DIR/export-$number" -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
    "${AUTH_FLAGS[@]}" > "$BUILD_DIR/export.log" 2>&1 \
    || { tail -40 "$BUILD_DIR/export.log" >&2; die "export failed, see $BUILD_DIR/export.log"; }
  package="$(find "$BUILD_DIR/export-$number" -maxdepth 1 \( -name '*.ipa' -o -name '*.pkg' \) | head -1)"
  [[ -n "$package" ]] || die "export wrote no .ipa or .pkg in $BUILD_DIR/export-$number"
  upload_package "$package"
}

# altool reads the API key only from a private_keys folder, under the name AuthKey_<id>.p8.
upload_package() {
  local package="$1" keys="$HOME/.private_keys"
  mkdir -p "$keys" && chmod 700 "$keys"
  [[ -f "$keys/AuthKey_$ASC_KEY_ID.p8" ]] || install -m 600 "$ASC_KEY_PATH" "$keys/AuthKey_$ASC_KEY_ID.p8"
  xcrun altool --upload-app -f "$package" -t "$ALTOOL_PLATFORM" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" \
    > "$BUILD_DIR/upload.log" 2>&1 || { tail -20 "$BUILD_DIR/upload.log" >&2; die "upload failed, see $BUILD_DIR/upload.log"; }
  grep -q "UPLOAD SUCCEEDED" "$BUILD_DIR/upload.log" || die "altool did not report UPLOAD SUCCEEDED, see $BUILD_DIR/upload.log"
}

build_json() {
  asc GET "/v1/builds?filter%5Bapp%5D=$APP_ID&filter%5Bversion%5D=$1&filter%5BpreReleaseVersion.platform%5D=$ASC_PLATFORM&limit=1"
}

wait_for_processing() {
  local number="$1" state attempt
  for ((attempt = 1; attempt <= POLL_LIMIT; attempt++)); do
    state="$(build_json "$number" | jq -r '.data[0].attributes.processingState // "NOT_VISIBLE_YET"')"
    log "build $number processingState=$state ($attempt/$POLL_LIMIT)"
    case "$state" in
      VALID) return 0 ;;
      INVALID | FAILED) die "build $number processing ended in $state" ;;
    esac
    sleep "$POLL_SECONDS"
  done
  die "build $number not VALID after $((POLL_LIMIT * POLL_SECONDS)) seconds"
}

set_export_compliance() {
  local number="$1" id uses body="$BUILD_DIR/build-patch.json"
  id="$(build_json "$number" | jq -r '.data[0].id')"
  uses="$(build_json "$number" | jq -r '.data[0].attributes.usesNonExemptEncryption')"
  [[ "$uses" == "null" ]] || return 0
  jq -n --arg id "$id" '{data:{type:"builds",id:$id,attributes:{usesNonExemptEncryption:false}}}' > "$body"
  asc PATCH "/v1/builds/$id" "$body" > /dev/null
  log "set usesNonExemptEncryption=false on build $number"
}

ensure_group() {
  local id body="$BUILD_DIR/group-create.json"
  id="$(asc GET "/v1/apps/$APP_ID/betaGroups?limit=200" \
    | jq -r --arg n "$GROUP_NAME" '[.data[] | select(.attributes.name == $n and .attributes.isInternalGroup == true)][0].id // empty')"
  if [[ -z "$id" ]]; then
    jq -n --arg n "$GROUP_NAME" --arg app "$APP_ID" '{data:{type:"betaGroups",
      attributes:{name:$n,isInternalGroup:true,hasAccessToAllBuilds:true},
      relationships:{app:{data:{type:"apps",id:$app}}}}}' > "$body"
    id="$(asc POST /v1/betaGroups "$body" | jq -r '.data.id')"
  fi
  echo "$id"
}

account_holder_file() {
  local file="$BUILD_DIR/account-holder.json"
  asc GET "/v1/users?limit=200" | jq '[.data[] | select(.attributes.roles | index("ACCOUNT_HOLDER"))][0].attributes
    | {email:.username, firstName, lastName}' > "$file"
  [[ "$(jq -r '.email // empty' "$file")" != "" ]] || die "no ACCOUNT_HOLDER user found"
  echo "$file"
}

tester_id_in_file() {
  jq -r --slurpfile holder "$1" '[.data[] | select(.attributes.email == $holder[0].email)][0].id // empty'
}

create_tester_in_group() {
  local group="$1" holder="$2" body="$BUILD_DIR/tester.json"
  jq --arg g "$group" '{data:{type:"betaTesters",attributes:.,
    relationships:{betaGroups:{data:[{type:"betaGroups",id:$g}]}}}}' "$holder" > "$body"
  asc POST /v1/betaTesters "$body" > /dev/null
}

add_tester_to_group() {
  local group="$1" tester="$2" body="$BUILD_DIR/tester-link.json"
  jq -n --arg t "$tester" '{data:[{type:"betaTesters",id:$t}]}' > "$body"
  asc POST "/v1/betaGroups/$group/relationships/betaTesters" "$body" > /dev/null
}

# Tester records are per app, so only this app's testers count (the holder is a tester of other apps).
ensure_tester() {
  local group="$1" holder member existing
  holder="$(account_holder_file)"
  member="$(asc GET "/v1/betaGroups/$group/betaTesters?limit=200" | tester_id_in_file "$holder")"
  [[ -z "$member" ]] || return 0
  existing="$(asc GET "/v1/betaTesters?filter%5Bapps%5D=$APP_ID&limit=200" | tester_id_in_file "$holder")"
  if [[ -z "$existing" ]]; then
    create_tester_in_group "$group" "$holder"
  else
    add_tester_to_group "$group" "$existing"
  fi
}

print_summary() {
  local number="$1" group="$2" state testers
  state="$(build_json "$number" | jq -r '.data[0].attributes.processingState')"
  testers="$(asc GET "/v1/betaGroups/$group/betaTesters?limit=200" | jq '.data | length')"
  log "platform: $PLATFORM"
  log "build number: $number"
  log "processing state: $state"
  log "group: $GROUP_NAME"
  log "tester count: $testers"
}

# Every release ships a higher version (scripts/version.sh): a marketing version that already has a build on this
# platform was released before, so a new upload needs a higher VERSION first. Resuming our own upload is exempt.
require_unreleased_version() {
  local version count
  version="$(tr -d '[:space:]' < "$REPO_ROOT/VERSION")"
  count="$(asc GET "/v1/preReleaseVersions?filter%5Bapp%5D=$APP_ID&filter%5Bversion%5D=$version&filter%5Bplatform%5D=$ASC_PLATFORM&include=builds&limit=1" \
    | jq '[.data[]?.relationships.builds.data[]?] | length')"
  [[ "$count" == 0 ]] || die "version $version already has a $PLATFORM build in TestFlight: raise VERSION first (bash scripts/version.sh bump, or a new minor/major)"
  log "version $version has no $PLATFORM build yet"
}

choose_build_number() {
  if [[ -f "$PENDING_FILE" ]]; then
    cat "$PENDING_FILE"
  else
    next_build_number
  fi
}

main() {
  [[ -f "$ASC_KEY_PATH" ]] || die "missing API key file $ASC_KEY_PATH"
  mkdir -p "$BUILD_DIR" && chmod 700 "$BUILD_DIR"   # holds the account holder file and API answers: owner only
  auth_flags
  local number group
  number="$(choose_build_number)"
  if [[ -f "$PENDING_FILE" ]]; then
    log "build $number already uploaded, resuming at processing"
  else
    require_unreleased_version
    archive_app "$number"
    export_and_upload "$number"
    echo "$number" > "$PENDING_FILE"
  fi
  wait_for_processing "$number"
  set_export_compliance "$number"
  group="$(ensure_group)"
  ensure_tester "$group"
  print_summary "$number" "$group"
  mv "$PENDING_FILE" "$BUILD_DIR/last-shipped-build-$PLATFORM"
  log "version: $(bash "$SCRIPT_DIR/version.sh" show)"
}
# The version is set on purpose at the start of a release (scripts/version.sh set <x.y.z>, major for a breaking
# change, minor for features, patch for fixes) and the same version ships on every platform of that release. This
# script only checks it (require_unreleased_version); it never bumps.

main "$@"
