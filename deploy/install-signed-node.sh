#!/usr/bin/env bash
# Runs ON a Mac whose application firewall is enabled. Homebrew's node is ad-hoc signed, so the
# firewall drops its incoming connections. The official Node.js build is Developer ID signed and is
# allowed by the firewall's own "allow downloaded signed software" policy, with no firewall change.
# Installs the official build privately for fardeskd and prints the node path to use.
set -euo pipefail

NODE_LINE="${FARDESK_NODE_LINE:-latest-v22.x}"
DEST="$HOME/.local/share/fardeskd-node"
BASE_URL="https://nodejs.org/dist/$NODE_LINE"
ARCH="$(uname -m | sed 's/x86_64/x64/')"

mkdir -p "$DEST"
cd "$DEST"
curl -fsS -o SHASUMS256.txt "$BASE_URL/SHASUMS256.txt"
TARBALL="$(grep -o "node-v[0-9.]*-darwin-$ARCH.tar.gz" SHASUMS256.txt | head -1)"
[ -n "$TARBALL" ] || { echo "no darwin-$ARCH build listed" >&2; exit 1; }
curl -fsS -o "$TARBALL" "$BASE_URL/$TARBALL"
grep " $TARBALL\$" SHASUMS256.txt | shasum -a 256 -c -
tar -xzf "$TARBALL"
NODE_BIN="$DEST/${TARBALL%.tar.gz}/bin/node"
codesign --verify --strict "$NODE_BIN"
codesign -dv "$NODE_BIN" 2>&1 | grep -E "Authority=Developer ID|TeamIdentifier"
"$NODE_BIN" --version
echo "FARDESK_NODE=$NODE_BIN"
