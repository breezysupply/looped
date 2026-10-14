#!/usr/bin/env bash
# L02 reset: rebuild the exercise repository for the same variant. This
# discards work inside /opt/beacon-l02/repo only; your notes in evidence/ stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l02
V="$(cat "$LAB/.lab/variant" 2>/dev/null || echo variant-a)"
pkill -f "beacon api --config /tmp/looped-l02-" >/dev/null 2>&1 || true
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L02 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
