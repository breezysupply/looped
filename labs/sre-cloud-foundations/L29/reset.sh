#!/usr/bin/env bash
# L29 reset: put the colleague's draft back for the same variant (or
# LOOPED_VARIANT). Your worksheet is kept as work/translation.yaml.bak;
# evidence/ is untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
[ -f "$WORK/translation.yaml" ] && cp "$WORK/translation.yaml" "$WORK/translation.yaml.bak"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L29 reset; previous worksheet saved as work/translation.yaml.bak"
