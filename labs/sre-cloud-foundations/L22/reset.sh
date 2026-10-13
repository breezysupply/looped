#!/usr/bin/env bash
# L22 reset: restore the draft rules and the month fixture for the same
# variant (or LOOPED_VARIANT). Your rules are kept as
# work/rules/beacon-slo.rules.yml.bak; tests and worksheet are untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l22_guard
V="$(l22_variant)"
[ -f "$WORK/rules/beacon-slo.rules.yml" ] && cp "$WORK/rules/beacon-slo.rules.yml" "$WORK/rules/beacon-slo.rules.yml.bak"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L22 reset; your previous rules are in work/rules/beacon-slo.rules.yml.bak"
