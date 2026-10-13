#!/usr/bin/env bash
# L09 reset: put the draft inventory back for the same variant (or
# LOOPED_VARIANT). Your current inventory is kept as work/inventory.json.bak;
# evidence/ is untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="$HERE/work"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
[ -f "$WORK/inventory.json" ] && cp "$WORK/inventory.json" "$WORK/inventory.json.bak"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L09 reset; previous inventory saved as work/inventory.json.bak"
