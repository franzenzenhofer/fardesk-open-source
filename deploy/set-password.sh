#!/usr/bin/env bash
# Sets the one Fardesk password on every given machine. Run it yourself, in a terminal.
#
# Usage: bash deploy/set-password.sh <local|ssh-host> [<local|ssh-host> ...]
# Example: bash deploy/set-password.sh local laptop build-server
#
# The password is typed once (no echo), lives only in this shell variable, is piped to
# `fardeskd set-password` on stdin and is never written to disk or passed as an argument.
# Each daemon stores only a salted scrypt hash, revokes every device token and (when running)
# reloads itself; every phone and CLI has to log in again afterwards.
set -euo pipefail

if [ "$#" -eq 0 ]; then
  sed -n '2,11p' "$0" >&2
  exit 2
fi

# shellcheck disable=SC2088
REMOTE_MAIN='~/.local/share/fardeskd/dist/main.js'

read -r -s -p "New Fardesk password: " PW
printf '\n' >&2
read -r -s -p "Repeat: " PW_AGAIN
printf '\n' >&2
if [ "$PW" != "$PW_AGAIN" ]; then
  unset PW PW_AGAIN
  echo "the two entries do not match" >&2
  exit 1
fi
unset PW_AGAIN

status=0
for host in "$@"; do
  echo "== $host" >&2
  if [ "$host" = "local" ]; then
    printf '%s\n' "$PW" | node "$HOME/.local/share/fardeskd/dist/main.js" set-password || status=1
  else
    printf '%s\n' "$PW" | ssh "$host" "bash -lc 'node $REMOTE_MAIN set-password'" || status=1
  fi
done

unset PW
exit "$status"
