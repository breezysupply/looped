#!/usr/bin/env bash
# L04 reset: stop the lab processes, unmount and recreate the lab image, re-seed,
# and re-inject the same variant (or LOOPED_VARIANT). Your notes in evidence/ stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l04
V="$(cat "$LAB/.lab/variant" 2>/dev/null || echo variant-a)"
bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L04 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
