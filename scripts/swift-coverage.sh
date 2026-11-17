#!/usr/bin/env bash
# Runs the FardeskKit tests with coverage and gates lines, functions and regions
# against a pragmatic floor for packages/FardeskKit/Sources.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
package_dir="$(cd "$script_dir/../packages/FardeskKit" && pwd)"
sources_dir="$package_dir/Sources"

cd "$package_dir"
# Serial on purpose: every integration suite starts a real daemon, and 70 of them in parallel
# push timing-based tests (follow, kill) past their deadlines on a busy Mac.
swift test --enable-code-coverage --no-parallel

codecov_json="$(swift test --show-codecov-path)"
profdata="$(dirname "$codecov_json")/default.profdata"
bin_path="$(swift build --show-bin-path)"
test_binary="$(find "$bin_path" -maxdepth 4 -path '*.xctest/Contents/MacOS/*' -type f | head -n 1)"

[[ -f "$profdata" ]] || { echo "FAIL: profdata not found at $profdata" >&2; exit 1; }
[[ -n "$test_binary" ]] || { echo "FAIL: test binary not found under $bin_path" >&2; exit 1; }

source_files=()
while IFS= read -r file; do
  source_files+=("$file")
done < <(find "$sources_dir" -name '*.swift' -type f | sort)
[[ ${#source_files[@]} -gt 0 ]] || { echo "FAIL: no Swift files under $sources_dir" >&2; exit 1; }

echo
echo "Coverage for $sources_dir"
xcrun llvm-cov report "$test_binary" -instr-profile="$profdata" "${source_files[@]}"

summary="$(xcrun llvm-cov export -summary-only "$test_binary" -instr-profile="$profdata" "${source_files[@]}")"

failed=0
# Pragmatic floor (percent). Critical paths keep strong tests; glue and views are not chased.
FLOOR="${FARDESK_SWIFT_COVERAGE_FLOOR:-80}"
for metric in lines functions regions; do
  count="$(jq ".data[0].totals.$metric.count" <<<"$summary")"
  covered="$(jq ".data[0].totals.$metric.covered" <<<"$summary")"
  percent=$(( count == 0 ? 100 : covered * 100 / count ))
  echo "$metric: $covered / $count ($percent%)"
  if (( percent < FLOOR )); then
    echo "FAIL: $metric coverage $percent% is under the floor of $FLOOR%" >&2
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
echo "OK: coverage floor of $FLOOR% passed"
