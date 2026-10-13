#!/usr/bin/env bash
# L10 reset: restore the exporter's starting policy and session for the same
# variant (or LOOPED_VARIANT). Your policy is kept as
# work/exporter-policy.json.bak; predictions, tests and evidence are untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
[ -f "$WORK/exporter-policy.json" ] && cp "$WORK/exporter-policy.json" "$WORK/exporter-policy.json.bak"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L10 reset; previous policy saved as work/exporter-policy.json.bak"
