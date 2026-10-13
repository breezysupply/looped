#!/usr/bin/env bash
# L07 reset: remove only generated output (data/, out/) and regenerate the
# incident log for the same variant (or LOOPED_VARIANT). Your code, tests and
# fixtures are never touched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L07_WORK:-$HERE/work}"
[ -d "$WORK" ] || die "workspace $WORK missing; run setup.sh"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
rm -rf "${WORK:?}/data" "${WORK:?}/out"
L07_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L07 reset to ${LOOPED_VARIANT:-$V}; your code untouched"
