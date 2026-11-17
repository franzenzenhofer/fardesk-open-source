#!/usr/bin/env bash
# The one gate for the whole repo. Every step fails the build.
#   1. DRY gate: zero clones (TypeScript and Swift, sources and tests)
#   2. Daemon: typecheck, lint, tests with 100% coverage, build
#   3. FardeskKit + CLI: tests with 100% lines, functions and regions
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "== DRY gate (jscpd, zero clones) =="
bash "$ROOT/scripts/dry-gate.sh"

echo "== Daemon gates =="
(cd "$ROOT/daemon/fardeskd" && npm run gates:daemon)

echo "== Swift coverage gate =="
bash "$ROOT/scripts/swift-coverage.sh"

echo "ALL GATES PASSED"
