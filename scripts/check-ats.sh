#!/usr/bin/env bash
# App Transport Security gate (ticket #100). Fardesk has no TLS of its own: the daemon speaks plain HTTP on its tailnet
# address and Tailscale (WireGuard) encrypts the link. Since iOS 17 / macOS 14, ATS refuses plain HTTP to an IP address
# unless the address range is listed in NSExceptionDomains, so the apps carry
#   NSAppTransportSecurity > NSExceptionDomains > "100.64.0.0/10" > NSExceptionAllowsInsecureHTTPLoads
# (apps/Fardesk/project.yml, one block shared by the app and the widget extension).
#
# What this check does, with the SAME dictionary the apps carry (read from the Info.plist that xcodegen generates from
# project.yml, never copied):
#   1. builds the Swift `fardesk` CLI, wraps it in a minimal .app bundle whose Info.plist holds that dictionary (ATS is
#      enforced for app bundles, not for a bare command-line tool with a __TEXT,__info_plist section: measured in the
#      ATS spike of ticket #62) and pairs it with a sandbox daemon over plain HTTP: must succeed;
#   2. proves ATS is really active in such a bundle: plain HTTP to a public IP literal is refused (-1022) before any
#      connection, with and without the exception (the exception is scoped to the tailnet range);
#   3. runs the same CLI from a bundle whose Info.plist has the ATS block minus NSExceptionDomains and prints what
#      happens (information only, see the limit).
#
# Limit, stated plainly: connections to this machine's own address (loopback, its own tailnet address) are exempt from
# ATS on macOS, so step 3 cannot be asserted to be refused here; the sandbox daemon is on this machine. The proof that
# the exception is needed and sufficient for a REMOTE tailnet machine is the owner's real phone scanning the hub's
# code. This check catches the other failures: a missing or misspelled dictionary in project.yml, a CLI that does not
# speak plain HTTP, a pairing flow that broke.
#
# macOS only (plutil, xcodegen, codesign). Elsewhere it prints a skip line and exits 0.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(uname -s)" = "Darwin" ] || { echo "check-ats: skipped (macOS only)"; exit 0; }
command -v xcodegen > /dev/null || { echo "check-ats: xcodegen is not installed (brew install xcodegen)" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/fardesk-ats.XXXXXX")"
DAEMON_PID=""
cleanup() {
  [ -z "$DAEMON_PID" ] || kill "$DAEMON_PID" 2> /dev/null || true
  echo "check-ats: scratch folder $WORK (move it to the Trash when done)"
}
trap cleanup EXIT
fail() { echo "check-ats: FAIL: $*" >&2; exit 1; }

# 1. The real ATS dictionary of the app, from project.yml through xcodegen.
(cd "$ROOT/apps/Fardesk" && xcodegen generate --quiet > /dev/null)
APP_PLIST="$ROOT/apps/Fardesk/Config/Info.plist"
plutil -extract NSAppTransportSecurity xml1 -o "$WORK/ats.xml" "$APP_PLIST" || fail "the app Info.plist has no NSAppTransportSecurity"
plutil -extract 'NSAppTransportSecurity.NSExceptionDomains.100\.64\.0\.0/10.NSExceptionAllowsInsecureHTTPLoads' raw -o - "$APP_PLIST" \
  | grep -qx true || fail "the app Info.plist does not except 100.64.0.0/10 for plain HTTP"
plutil -extract 'NSAppTransportSecurity.NSExceptionDomains.100\.64\.0\.0/10.NSExceptionAllowsInsecureHTTPLoads' raw -o - "$ROOT/apps/Fardesk/Config/WidgetsInfo.plist" \
  | grep -qx true || fail "the widget extension Info.plist does not carry the same exception"

make_bundle() { # <name> <executable> <with|without> -> path of the executable inside the bundle
  local app="$WORK/$1.app" plist="$WORK/$1.app/Contents/Info.plist"
  mkdir -p "$app/Contents/MacOS"
  plutil -create xml1 "$plist"
  plutil -insert CFBundleIdentifier -string "com.example.fardesk.atscheck.$1" "$plist"
  plutil -insert CFBundleExecutable -string "$(basename "$2")" "$plist"
  plutil -insert CFBundlePackageType -string APPL "$plist"
  plutil -insert CFBundleName -string "$1" "$plist"
  plutil -insert CFBundleVersion -string 1 "$plist"
  plutil -insert CFBundleShortVersionString -string 1 "$plist"
  plutil -insert LSMinimumSystemVersion -string 14.0 "$plist"
  plutil -insert NSAppTransportSecurity -xml "$(cat "$WORK/ats.xml")" "$plist"
  [ "$3" = "with" ] || plutil -remove NSAppTransportSecurity.NSExceptionDomains "$plist"
  cp "$2" "$app/Contents/MacOS/"
  codesign --force --sign - "$app" > /dev/null 2>&1 || fail "codesign of $1 failed"
  echo "$app/Contents/MacOS/$(basename "$2")"
}

# 2. The CLI and the probe, each in a bundle with the app's dictionary and in one without the exception.
swift build --package-path "$ROOT/packages/FardeskKit" --product fardesk --scratch-path "$WORK/build" > "$WORK/build.log" 2>&1 \
  || { tail -20 "$WORK/build.log" >&2; fail "swift build of the fardesk CLI failed"; }
swiftc -O "$ROOT/scripts/lib/ats-probe.swift" -o "$WORK/ats-probe" > "$WORK/probe-build.log" 2>&1 || { cat "$WORK/probe-build.log" >&2; fail "the probe did not build"; }
CLI_WITH="$(make_bundle cli-with "$WORK/build/debug/fardesk" with)"
CLI_WITHOUT="$(make_bundle cli-without "$WORK/build/debug/fardesk" without)"
PROBE_WITH="$(make_bundle probe-with "$WORK/ats-probe" with)"
PROBE_WITHOUT="$(make_bundle probe-without "$WORK/ats-probe" without)"

# 3. ATS is active in a bundle: plain HTTP to a public IP literal (TEST-NET-3) is refused before any connection.
PUBLIC_URL="http://203.0.113.7:9/"
for probe in "$PROBE_WITH" "$PROBE_WITHOUT"; do
  answer="$("$probe" "$PUBLIC_URL")"
  [ "$answer" = "error NSURLErrorDomain#-1022" ] || fail "ATS did not refuse plain HTTP to a public IP literal in $(basename "$(dirname "$(dirname "$(dirname "$probe")")")"): got '$answer'"
done
echo "check-ats: OK ATS is active in a bundle (plain HTTP to a public IP refused, -1022), with and without the exception"

# 4. A sandbox daemon on loopback (the test seam FARDESK_TEST_SANDBOX, as in the daemon's own tests).
(cd "$ROOT/daemon/fardeskd" && npm run build --silent > /dev/null)
TOKEN="$(openssl rand -hex 32)"
PORT=$((20000 + RANDOM % 20000))
mkdir -p "$WORK/claude" "$WORK/state"
printf '{"name":"ats-check","token":"%s","bind":{"address":"127.0.0.1","port":%s},"claudeHomes":["%s"],"stateDir":"%s"}\n' \
  "$TOKEN" "$PORT" "$WORK/claude" "$WORK/state" > "$WORK/config.json"
FARDESK_TEST_SANDBOX="$WORK" node "$ROOT/daemon/fardeskd/dist/main.js" serve --config "$WORK/config.json" > "$WORK/daemon.log" 2>&1 &
DAEMON_PID=$!
for _ in $(seq 1 100); do
  curl -sf -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/machine" > /dev/null 2>&1 && break
  sleep 0.2
done
curl -sf -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/machine" > /dev/null || { cat "$WORK/daemon.log" >&2; fail "the sandbox daemon did not answer"; }

pairing_link() { # a fresh one-time code in the link the way `fardeskd pair` prints it
  local code json
  code="$(curl -sf -X POST -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/auth/pair-code" | plutil -extract code raw -o - -)"
  json="$(printf '{"v":3,"name":"ats-check","url":"http://127.0.0.1:%s","code":"%s","hub":false}' "$PORT" "$code")"
  printf 'fardesk://pair?d=%s' "$(printf '%s' "$json" | base64 | tr '+/' '-_' | tr -d '=\n')"
}

run_pair() { # <name> <executable> -> exit status of `fardesk pair`
  local status=0
  mkdir -p "$WORK/home-$1"
  FARDESK_MACHINES="$WORK/home-$1/machines.json" FARDESK_TOKENS="$WORK/home-$1/tokens.json" FARDESK_TEST_TAILSCALE=on \
    "$2" pair "$(pairing_link)" > "$WORK/pair-$1.out" 2> "$WORK/pair-$1.err" || status=$?
  return "$status"
}

# 5. The CLI with the app's dictionary pairs over plain HTTP.
run_pair with "$CLI_WITH" || { cat "$WORK/pair-with.err" >&2; fail "pairing over plain HTTP failed with the app's ATS dictionary"; }
grep -q "http://127.0.0.1:$PORT" "$WORK/home-with/machines.json" || fail "the machine was not saved after pairing"
echo "check-ats: OK the CLI with the app's ATS dictionary paired over plain HTTP"

# 6. Information only (own-machine addresses are exempt, see the limit above).
if run_pair without "$CLI_WITHOUT"; then
  echo "check-ats: info: without the exception the sandbox pairing also works (own-machine address, exempt from ATS)"
else
  echo "check-ats: info: without the exception the pairing is refused: $(head -c 160 "$WORK/pair-without.err" | tr '\n' ' ')"
fi
echo "check-ats: PASSED (the owner's real phone scan stays the final acceptance)"
