#!/usr/bin/env bash
# Sourced by scripts/setup/*.sh. Every setup script is idempotent, prints what it changed and understands --check
# (verify only, change nothing, exit 1 when something is not as configured).
#
#   . "$(dirname "$0")/../lib/setup-common.sh"
#   setup_init "$@"          # sets CHECK_ONLY (0|1) and ARGS (the arguments without --check)
#   ...
#   setup_finish

# shellcheck source=fardesk-env.sh
. "$(dirname "${BASH_SOURCE[0]}")/fardesk-env.sh"

export REPO_ROOT="$FARDESK_REPO_ROOT"
# The remote shell expands the tilde.
# shellcheck disable=SC2088
REMOTE_MAIN='~/.local/share/fardeskd/dist/main.js'
CHECK_ONLY=0
ARGS=()
FAILED=0

setup_init() {
  local arg
  for arg in "$@"; do
    if [[ "$arg" == "--check" ]]; then CHECK_ONLY=1; else ARGS+=("$arg"); fi
  done
  fardesk_load_env
}

say() { printf '%s\n' "$*"; }
ok() { printf 'ok       %s\n' "$*"; }
changed() { printf 'changed  %s\n' "$*"; }
would() { printf 'needs    %s\n' "$*"; FAILED=1; }
problem() { printf 'PROBLEM  %s\n' "$*" >&2; FAILED=1; }
die() { printf 'ERROR    %s\n' "$*" >&2; exit 1; }

setup_finish() {
  if [[ "$FAILED" -ne 0 ]]; then
    if [[ "$CHECK_ONLY" -eq 1 ]]; then say "check failed"; else say "finished with problems"; fi
    exit 1
  fi
  say "all good"
}

# machine_target NAME: the ssh target of a machine of FARDESK_MACHINES; stops when the name is unknown.
machine_target() { fardesk_machine_target "$1" || exit 1; }

# on_machine TARGET COMMAND: runs a shell command there ("local" = here, else over ssh in a login shell).
on_machine() {
  if [[ "$1" == "local" ]]; then
    bash -lc "$2"
  else
    printf '%s\n' "$2" | ssh -o BatchMode=yes -o ConnectTimeout=10 "$1" 'bash -l -s'
  fi
}

# fardeskd TARGET ARGS...: runs the installed daemon binary on a machine.
fardeskd() {
  local target="$1"
  shift
  on_machine "$target" "node $REMOTE_MAIN $*"
}

# daemon_config_value TARGET JQ_FILTER: one value of the machine's config.json ("null" when the key is absent).
daemon_config_value() {
  on_machine "$1" "jq -r '$2' ~/.config/fardesk/config.json"
}
