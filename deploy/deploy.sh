#!/usr/bin/env bash
# Builds fardeskd and installs it on one machine.
# Usage: bash deploy/deploy.sh <ssh-host|local> <machine-name>
# Example: bash deploy/deploy.sh laptop "Laptop"
# The installed tarball stays next to dist/ as release.tgz: the daemon serves it (GET /v1/update/package) and installs a
# newer one it is given (POST /v1/machine/update), so machines can update each other without this script.
# The launchd label is <FARDESK_BUNDLE_PREFIX>.fardeskd; the prefix comes from fardesk.env (see fardesk.env.example).
set -euo pipefail

TARGET="${1:?usage: deploy.sh <ssh-host|local> <machine-name>}"
MACHINE_NAME="${2:?usage: deploy.sh <ssh-host|local> <machine-name>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/lib/fardesk-env.sh"
fardesk_load_env
fardesk_require FARDESK_BUNDLE_PREFIX
FARDESK_LABEL="$(fardesk_label)"
DAEMON="$ROOT/daemon/fardeskd"
REMOTE_DIR=".local/share/fardeskd"
STAGE="$(mktemp -d)"
TARBALL="$STAGE/release.tgz"

build_release() {
  (cd "$DAEMON" && npm run build)
  mkdir -p "$STAGE/release/deploy"
  cp -R "$DAEMON/dist" "$DAEMON/package.json" "$DAEMON/package-lock.json" "$STAGE/release/"
  cp "$ROOT/deploy/install-local.sh" "$STAGE/release/"
  cp "$ROOT"/deploy/*.template "$ROOT"/deploy/fardeskd-run.zsh "$STAGE/release/deploy/"
  COPYFILE_DISABLE=1 tar --no-xattrs -czf "$TARBALL" -C "$STAGE/release" .
}

install_local() {
  mkdir -p "$HOME/$REMOTE_DIR"
  tar -xzf "$TARBALL" -C "$HOME/$REMOTE_DIR"
  cp "$TARBALL" "$HOME/$REMOTE_DIR/release.tgz"
  FARDESK_LABEL="$FARDESK_LABEL" FARDESK_SKIP_HOOKS="${FARDESK_SKIP_HOOKS:-}" bash "$HOME/$REMOTE_DIR/install-local.sh" "$MACHINE_NAME"
}

install_remote() {
  ssh "$TARGET" "mkdir -p ~/$REMOTE_DIR"
  scp -q "$TARBALL" "$TARGET:$REMOTE_DIR/release.tgz"
  ssh "$TARGET" "tar -xzf ~/$REMOTE_DIR/release.tgz -C ~/$REMOTE_DIR"
  ssh "$TARGET" "FARDESK_LABEL='$FARDESK_LABEL' FARDESK_SKIP_HOOKS='${FARDESK_SKIP_HOOKS:-}' bash -l ~/$REMOTE_DIR/install-local.sh '$MACHINE_NAME'"
}

build_release
if [ "$TARGET" = "local" ]; then install_local; else install_remote; fi
