#!/usr/bin/env bash
# The one version of Fardesk lives in VERSION (repo root). This script copies it everywhere else.
#   bash scripts/version.sh sync   write VERSION into the app (Version.xcconfig), the daemon and the CLI
#   bash scripts/version.sh bump   raise the patch number (1.8.1 -> 1.8.2), then sync
#   bash scripts/version.sh show   print it
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/VERSION"
version="$(tr -d '[:space:]' < "$FILE")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be MAJOR.MINOR.PATCH, got '$version'" >&2; exit 1; }

sync() {
  local v="$1"
  sed -i '' -E "s/^MARKETING_VERSION = .*/MARKETING_VERSION = $v/" "$ROOT/apps/Fardesk/Config/Version.xcconfig"
  sed -i '' -E "s/^  \"version\": \"[0-9.]+\",/  \"version\": \"$v\",/" "$ROOT/daemon/fardeskd/package.json"
  sed -i '' -E "s/public static let version = \"[0-9.]+\"/public static let version = \"$v\"/" \
    "$ROOT/packages/FardeskKit/Sources/FardeskCLICore/FardeskCLI.swift"
  grep -q "^MARKETING_VERSION = $v$" "$ROOT/apps/Fardesk/Config/Version.xcconfig" || { echo "app version not written" >&2; exit 1; }
  grep -q "\"version\": \"$v\"" "$ROOT/daemon/fardeskd/package.json" || { echo "daemon version not written" >&2; exit 1; }
  grep -q "version = \"$v\"" "$ROOT/packages/FardeskKit/Sources/FardeskCLICore/FardeskCLI.swift" || { echo "CLI version not written" >&2; exit 1; }
}

case "${1:-show}" in
  show) echo "$version" ;;
  sync) sync "$version"; echo "synced $version" ;;
  bump)
    next="${version%.*}.$(( ${version##*.} + 1 ))"
    echo "$next" > "$FILE"
    sync "$next"
    echo "bumped $version -> $next"
    ;;
  *) echo "usage: version.sh show|sync|bump" >&2; exit 1 ;;
esac
