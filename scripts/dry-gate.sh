#!/usr/bin/env bash
# DRY gate: fails on any copy-pasted block in TypeScript or Swift (config: .jscpd.json).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec "$ROOT/daemon/fardeskd/node_modules/.bin/jscpd" --config "$ROOT/.jscpd.json"
