#!/usr/bin/env bash
# Runs ON the target machine, inside the unpacked release directory.
# Usage: FARDESK_LABEL=<bundle prefix>.fardeskd bash install-local.sh <machine-name>   (deploy.sh sets the label)
# Idempotent: installs dependencies, writes the config on first install, installs the service,
# merges the Claude Code hooks (with a backup) and restarts the daemon.
set -euo pipefail

MACHINE_NAME="${1:?usage: install-local.sh <machine-name>}"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_PATH="${FARDESK_CONFIG:-$HOME/.config/fardesk/config.json}"
LOG_DIR="$HOME/.local/state/fardesk/logs"
LABEL="${FARDESK_LABEL:?set FARDESK_LABEL to the launchd label of the daemon (<bundle prefix>.fardeskd); deploy/deploy.sh does it}"
# A privately installed signed Node (deploy/install-signed-node.sh) wins: firewalled Macs need it.
SIGNED_NODE="$(ls -d "$HOME"/.local/share/fardeskd-node/node-v*/bin/node 2>/dev/null | sort | tail -1 || true)"
NODE_BIN="${FARDESK_NODE:-${SIGNED_NODE:-$(command -v node)}}"

render() {
  sed -e "s|__NODE__|$NODE_BIN|g" -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
      -e "s|__LOG_DIR__|$LOG_DIR|g" -e "s|__PATH__|$PATH|g" -e "s|__HOME__|$HOME|g" -e "s|__LABEL__|$LABEL|g" "$1"
}

install_dependencies() {
  (cd "$INSTALL_DIR" && npm ci --omit=dev --no-audit --no-fund)
}

ensure_config() {
  if [ ! -f "$CONFIG_PATH" ]; then
    node "$INSTALL_DIR/dist/main.js" init --name "$MACHINE_NAME"
  fi
}

install_launchd() {
  local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  render "$INSTALL_DIR/deploy/fardeskd.plist.template" > "$plist"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  # bootout is asynchronous: wait until the old job is gone before loading the new one.
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || break
    sleep 1
  done
  launchctl bootstrap "gui/$(id -u)" "$plist"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
}

install_systemd() {
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  render "$INSTALL_DIR/deploy/fardeskd.service.template" > "$unit_dir/fardeskd.service"
  systemctl --user daemon-reload
  systemctl --user enable fardeskd.service
  systemctl --user restart fardeskd.service
}

mkdir -p "$LOG_DIR"
install_dependencies
ensure_config
case "$(uname -s)" in
  Darwin) install_launchd ;;
  Linux) install_systemd ;;
  *) echo "unsupported OS: $(uname -s)" >&2; exit 1 ;;
esac
if [ "${FARDESK_SKIP_HOOKS:-}" = "1" ]; then
  echo "install-hooks skipped (FARDESK_SKIP_HOOKS=1)"
else
  node "$INSTALL_DIR/dist/main.js" install-hooks
fi
# Give the service a moment to bind before reporting.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if node "$INSTALL_DIR/dist/main.js" status | grep -q "daemon: answers"; then break; fi
  sleep 1
done
node "$INSTALL_DIR/dist/main.js" status
