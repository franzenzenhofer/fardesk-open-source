#!/usr/bin/env bash
# A built app carries no tailnet address (100.64.0.0/10): runs `strings` over a binary, or over every file of an
# .app folder (executable, Info.plist, widget extension, frameworks, resources).
#   check-app-tailnet.sh [--strings-out <file>] <Fardesk.app | executable>
# Prints the finding without the value. Exit 1 on a hit, 0 when clean. --strings-out keeps the strings for further
# checks (the private build gate matches them against the owner denylist).
# Limit: `strings` cannot see Swift small-string literals (15 bytes or less, such as "100.64.0.1"): arm64 keeps
# them as immediates inside instructions. A clean run proves that no LONG string is in the build, not that no short
# address is; the source-level gates over the tree stay the main guard.
set -euo pipefail
umask 077

die() { printf '[check-app-tailnet] ERROR: %s\n' "$*" >&2; exit 2; }

OUT=
if [ "${1:-}" = "--strings-out" ]; then
  [ -n "${2:-}" ] || die "--strings-out needs a file"
  OUT=$2; shift 2
fi
TARGET=${1:-}
[ -n "$TARGET" ] || die "usage: check-app-tailnet.sh [--strings-out <file>] <Fardesk.app | executable>"
[ -e "$TARGET" ] || die "no such binary: $TARGET"

if [ -z "$OUT" ]; then
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/fardesk-tailnet.XXXXXX")
  OUT="$WORK/strings.txt"
fi
if [ -d "$TARGET" ]; then
  [ -n "$(find "$TARGET" -type f -print -quit)" ] || die "no files in $TARGET"
  find "$TARGET" -type f -print0 | xargs -0 strings -a > "$OUT"
else
  strings -a "$TARGET" > "$OUT"
fi
[ -s "$OUT" ] || die "strings found nothing in $TARGET"

# 100.64.0.0/10 is 100.64.0.0 to 100.127.255.255. The range itself, written exactly as "100.64.0.0/10", is in every
# app on purpose (the ATS exception that lets the app talk to tailnet addresses only): it names no machine, so that one
# literal is removed before the scan; any concrete tailnet address still fails.
TAILNET='(^|[^0-9.])100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]{1,3}\.[0-9]{1,3}($|[^0-9])'
if lines=$(sed 's#100\.64\.0\.0/10##g' "$OUT" | grep -n -E "$TAILNET" | cut -d: -f1 | tr '\n' ' ') && [ -n "$lines" ]; then
  echo "HIT tailnet address, strings lines: $lines"
  exit 1
fi
echo "clean: no tailnet address in the strings of $(basename "$TARGET")"
