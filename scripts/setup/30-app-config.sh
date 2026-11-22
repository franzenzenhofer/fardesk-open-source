#!/usr/bin/env bash
# Writes the identity of your build into apps/Fardesk/Config/Local.xcconfig (git ignores it) from fardesk.env and
# runs xcodegen. Lines of Local.xcconfig this script does not own are left alone. No tracked file is edited.
# Usage: bash scripts/setup/30-app-config.sh [--check]
set -uo pipefail
. "$(dirname "$0")/../lib/setup-common.sh"
setup_init "$@"

fardesk_require FARDESK_BUNDLE_PREFIX || exit 1
CONFIG_DIR="$REPO_ROOT/apps/Fardesk/Config"
LOCAL="${FARDESK_LOCAL_XCCONFIG:-$CONFIG_DIR/Local.xcconfig}"

# The key = value pairs this script owns (key, then value), one per line pair.
wanted_pairs() {
  printf '%s\n' FARDESK_BUNDLE_PREFIX "$FARDESK_BUNDLE_PREFIX"
  printf '%s\n' FARDESK_TEAM_ID "${FARDESK_TEAM_ID:-}"
}

current_value() { # key
  [[ -f "$LOCAL" ]] || return 0
  sed -n "s|^$1 = ||p" "$LOCAL" | tail -1
}

write_key() { # key value: replaces the line, or appends one
  local key="$1" value="$2" tmp="$LOCAL.new" line found=0
  : > "$tmp"
  if [[ -f "$LOCAL" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      if [[ "$line" == "$key = "* || "$line" == "$key =" ]]; then printf '%s = %s\n' "$key" "$value" >> "$tmp"; found=1; else printf '%s\n' "$line" >> "$tmp"; fi
    done < "$LOCAL"
  fi
  [[ "$found" -eq 1 ]] || printf '%s = %s\n' "$key" "$value" >> "$tmp"
  mv "$tmp" "$LOCAL"
}

sync_keys() {
  local key value
  while IFS= read -r key && IFS= read -r value; do
    if [[ "$(current_value "$key")" == "$value" ]]; then ok "$key = $value"; continue; fi
    if [[ "$CHECK_ONLY" -eq 1 ]]; then would "$key in Local.xcconfig is \"$(current_value "$key")\", want \"$value\""; continue; fi
    write_key "$key" "$value"
    changed "$key = $value"
  done < <(wanted_pairs)
}

generate_project() {
  if [[ "$CHECK_ONLY" -eq 1 ]]; then
    if [[ -d "$REPO_ROOT/apps/Fardesk/Fardesk.xcodeproj" ]]; then ok "Fardesk.xcodeproj exists"; else would "xcodegen has not generated Fardesk.xcodeproj yet"; fi
    return
  fi
  command -v xcodegen > /dev/null 2>&1 || { problem "xcodegen is missing (brew install xcodegen)"; return; }
  (cd "$REPO_ROOT/apps/Fardesk" && xcodegen generate --quiet) || { problem "xcodegen generate failed"; return; }
  changed "Fardesk.xcodeproj generated"
}

sync_keys
generate_project
setup_finish
