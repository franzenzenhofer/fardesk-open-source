#!/usr/bin/env bash
# The one gate for the whole repo. Every step fails the build.
#   1. Private gates (internal/gates.sh: export gates, owner values, bats) when internal/ exists
#   2. DRY gate: zero clones (TypeScript and Swift, sources and tests)
#   3. Daemon: typecheck, lint, tests with 100% coverage, build
#   4. FardeskKit + CLI: tests with 100% lines, functions and regions
#   5. ATS check: the CLI with the app's App Transport Security dictionary pairs over plain HTTP (macOS only)
# Full run (default, before every commit and release): every step. The private gates (mostly shell and git) run in
# parallel with the daemon and Swift gates; each lane writes its own log and prints how long it took (ticket #137).
# --quick (in-between runs): only the lanes whose files changed against origin/main; the leak and DRY checks always.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODE="${1:-full}"
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/fardesk-gates.XXXXXX")"

timed() {
  local name="$1" started=$SECONDS code=0
  shift
  "$@" || code=$?
  echo "-- $name: $((SECONDS - started)) s (exit $code)"
  return "$code"
}

daemon_gates() { (cd "$ROOT/daemon/fardeskd" && npm run gates:daemon); }
swift_gates() { bash "$ROOT/scripts/swift-coverage.sh" && bash "$ROOT/scripts/check-ats.sh"; }

# Files changed against origin/main, committed or not.
changed() {
  { git -C "$ROOT" diff --name-only origin/main...HEAD; git -C "$ROOT" status --porcelain | cut -c4-; } | sort -u
}

wants() {
  [ "$MODE" != "--quick" ] && return 0
  changed | grep -q -E "$1"
}

# One lane in the background: its output goes to its log, its exit code to a file.
lane() {
  local name="$1"
  shift
  ( set +e; timed "$name" "$@" > "$LOGS/$name.log" 2>&1; echo $? > "$LOGS/$name.code" ) &
}

echo "== Gates ($MODE), logs in $LOGS =="
timed "DRY gate (jscpd, zero clones)" bash "$ROOT/scripts/dry-gate.sh"
if [ -f "$ROOT/internal/gates.sh" ]; then lane private bash "$ROOT/internal/gates.sh" "$MODE"; fi
# Daemon and Swift one after the other: both are heavy, and the real-claude daemon tests time out under load.
code_gates() {
  if wants '^daemon/'; then timed "daemon gates" daemon_gates || return 1; fi
  if wants '^(packages/|apps/)'; then timed "swift and ATS gates" swift_gates || return 1; fi
}
lane code code_gates
wait

failed=0
for code in "$LOGS"/*.code; do
  [ -e "$code" ] || continue
  name="$(basename "$code" .code)"
  tail -n 1 "$LOGS/$name.log"
  if [ "$(cat "$code")" != "0" ]; then
    failed=1
    echo "FAILED: $name (last lines of $LOGS/$name.log):"
    tail -n 30 "$LOGS/$name.log"
  fi
done
[ "$failed" = "0" ] || { echo "GATES FAILED in $SECONDS s"; exit 1; }
echo "ALL GATES PASSED ($MODE) in $SECONDS s"
