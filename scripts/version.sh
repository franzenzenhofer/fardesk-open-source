#!/usr/bin/env bash
# The one version of Fardesk lives in VERSION (repo root). This script copies it everywhere else.
#   bash scripts/version.sh sync   write VERSION into the app (Version.xcconfig), the daemon and the CLI
#   bash scripts/version.sh bump   raise the patch number (1.8.1 -> 1.8.2), then sync
#   bash scripts/version.sh show   print it
#   bash scripts/version.sh set <x.y.z>        set a new version at the start of a release (must be higher), then sync
#   bash scripts/version.sh is-newer <x.y.z>   exit 0 only if VERSION is strictly higher than <x.y.z>
# Every release (TestFlight, owner deploy, public repo, npm) ships a version higher than the last one: SemVer 2.0.0
# items 3 and 11 (https://semver.org/#spec-item-3, https://semver.org/#spec-item-11). Breaking change: major;
# new feature: minor; fix only: patch.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="$ROOT/VERSION"
version="$(tr -d '[:space:]' < "$FILE")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be MAJOR.MINOR.PATCH, got '$version'" >&2; exit 1; }

sync() {
  local v="$1"
  sed -i '' -E "s/^MARKETING_VERSION = .*/MARKETING_VERSION = $v/" "$ROOT/apps/Fardesk/Config/Version.xcconfig"
  sed -i '' -E "s/^  \"version\": \"[0-9.]+\",/  \"version\": \"$v\",/" "$ROOT/daemon/fardeskd/package.json"
  sed -i '' -E "1,10s/^(  \"version\": |      \"version\": )\"[0-9.]+\",/\1\"$v\",/" "$ROOT/daemon/fardeskd/package-lock.json"
  sed -i '' -E "s/public static let version = \"[0-9.]+\"/public static let version = \"$v\"/" \
    "$ROOT/packages/FardeskKit/Sources/FardeskCLICore/FardeskCLI.swift"
  grep -q "^MARKETING_VERSION = $v$" "$ROOT/apps/Fardesk/Config/Version.xcconfig" || { echo "app version not written" >&2; exit 1; }
  grep -q "\"version\": \"$v\"" "$ROOT/daemon/fardeskd/package.json" || { echo "daemon version not written" >&2; exit 1; }
  grep -q "version = \"$v\"" "$ROOT/packages/FardeskKit/Sources/FardeskCLICore/FardeskCLI.swift" || { echo "CLI version not written" >&2; exit 1; }
}

# is_newer <a> <b>: a > b, comparing major, minor and patch numerically (SemVer precedence, no pre-release part).
is_newer() {
  local -a a b
  IFS=. read -r -a a <<< "$1"
  IFS=. read -r -a b <<< "$2"
  for i in 0 1 2; do
    if (( 10#${a[i]} > 10#${b[i]} )); then return 0; fi
    if (( 10#${a[i]} < 10#${b[i]} )); then return 1; fi
  done
  return 1
}

case "${1:-show}" in
  show) echo "$version" ;;
  set)
    next="${2:-}"
    [[ "$next" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: version.sh set MAJOR.MINOR.PATCH" >&2; exit 2; }
    is_newer "$next" "$version" || { echo "refusing: $next is not higher than $version" >&2; exit 1; }
    echo "$next" > "$FILE"
    sync "$next"
    echo "set $version -> $next"
    ;;
  is-newer)
    other="${2:-}"
    [[ "$other" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: version.sh is-newer MAJOR.MINOR.PATCH" >&2; exit 2; }
    is_newer "$version" "$other" || { echo "VERSION $version is not higher than $other: raise it first (bash scripts/version.sh bump, or set a new minor/major)" >&2; exit 1; }
    ;;
  sync) sync "$version"; echo "synced $version" ;;
  bump)
    next="${version%.*}.$(( ${version##*.} + 1 ))"
    echo "$next" > "$FILE"
    sync "$next"
    echo "bumped $version -> $next"
    ;;
  *) echo "usage: version.sh show|sync|bump|set <x.y.z>|is-newer <x.y.z>" >&2; exit 1 ;;
esac
