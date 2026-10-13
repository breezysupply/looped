#!/usr/bin/env bash
# L08 reset: restart the fixture (fresh counters, faults mode) for the same
# variant (or LOOPED_VARIANT) and clear generated output in out/. Your code,
# tests and token are untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L08_WORK:-$HERE/work}"
[ -d "$WORK" ] || die "workspace $WORK missing; run setup.sh"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
rm -rf "${WORK:?}/out"
mkdir -p "$WORK/out"
L08_WORK="$WORK" LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L08 reset to ${LOOPED_VARIANT:-$V}"
