#!/usr/bin/env bash
# Sourced by the release, deploy and setup scripts. One config file, fardesk.env at the repo root (git ignores it,
# fardesk.env.example is the template); a path in FARDESK_ENV_FILE wins. Variables already set in the environment
# win over the file, so a single run can override one value.
#
#   . "$ROOT/scripts/lib/fardesk-env.sh"
#   fardesk_load_env
#   fardesk_require ASC_APP_ID ASC_KEY_ID || exit 1

FARDESK_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

fardesk_env_file() {
  printf '%s\n' "${FARDESK_ENV_FILE:-$FARDESK_REPO_ROOT/fardesk.env}"
}

fardesk_load_env() {
  local file key
  local saved=()
  file="$(fardesk_env_file)"
  [[ -f "$file" ]] || return 0
  for key in $(grep -oE '^[A-Z][A-Z0-9_]*=' "$file" | tr -d '='); do
    if [[ -n "${!key+x}" ]]; then saved+=("$key=${!key}"); fi
  done
  set -a
  # shellcheck disable=SC1090
  . "$file"
  set +a
  local pair
  for pair in ${saved[@]+"${saved[@]}"}; do
    export "${pair%%=*}=${pair#*=}"
  done
}

# fardesk_require NAME...: prints one line naming every missing variable and returns 1.
fardesk_require() {
  local name missing=()
  for name in "$@"; do
    if [[ -z "${!name:-}" ]]; then missing+=("$name"); fi
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'missing: %s. Set them in the environment or in %s (template: fardesk.env.example).\n' \
      "${missing[*]}" "$(fardesk_env_file)" >&2
    return 1
  fi
}

# fardesk_label: the launchd label of the daemon, <bundle prefix>.fardeskd.
fardesk_label() {
  printf '%s.fardeskd\n' "${FARDESK_BUNDLE_PREFIX:?FARDESK_BUNDLE_PREFIX is not set}"
}

# fardesk_machines: one "name|ssh target|host" line per machine of FARDESK_MACHINES ("Name|target|host;Name|target").
# The ssh target "local" is this computer; the optional host is the tailnet name or IP in URLs (default: the target).
fardesk_machines() {
  printf '%s\n' "${FARDESK_MACHINES:?FARDESK_MACHINES is not set}" | tr ';' '\n' | grep -v '^[[:space:]]*$'
}

# fardesk_machine_field NAME TARGET|HOST: one field of a machine; fails when the name is unknown.
fardesk_machine_field() {
  local line name target host
  while IFS= read -r line; do
    IFS='|' read -r name target host <<< "$line"
    if [[ "$name" == "$1" ]]; then
      case "$2" in
        TARGET) printf '%s\n' "$target" ;;
        HOST) printf '%s\n' "${host:-$target}" ;;
      esac
      return 0
    fi
  done < <(fardesk_machines)
  printf 'no machine named "%s" in FARDESK_MACHINES\n' "$1" >&2
  return 1
}

fardesk_machine_target() { fardesk_machine_field "$1" TARGET; }
fardesk_machine_host() { fardesk_machine_field "$1" HOST; }

# fardesk_tailnet_address HOST: the tailnet IPv4 address (100.64.0.0/10) of a machine, for a peer URL. A literal
# tailnet address passes; a name is resolved with `tailscale ip -4`; anything else is refused with a plain message
# (the daemon accepts only tailnet addresses as peers: Tailscale only).
fardesk_tailnet_address() {
  local host="$1" address o1 o2 rest
  if [[ "$host" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    address="$host"
  else
    address="$(tailscale ip -4 "$host" 2>/dev/null | head -n 1)"
    if [[ -z "$address" ]]; then
      printf '%s is not a tailnet address and `tailscale ip -4 %s` found no machine of that name: use its 100.64.x.x address as the host in FARDESK_MACHINES\n' "$host" "$host" >&2
      return 1
    fi
  fi
  IFS=. read -r o1 o2 rest <<< "$address"
  if [[ "$address" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ && "$o1" -eq 100 && "$o2" -ge 64 && "$o2" -le 127 ]]; then
    printf '%s\n' "$address"
    return 0
  fi
  printf '%s is not in the tailnet range 100.64.0.0/10: Tailscale only, no other way\n' "$address" >&2
  return 1
}
