#!/usr/bin/env bash
# L01 reset: restore the broken launcher for the same variant; keep your notes.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l01
[ -d "$LAB" ] || die "nothing to reset; run setup.sh"
pkill -f "python3 -m beacon api --config config/beacon.yaml" >/dev/null 2>&1 || true
V="$(cat "$LAB/.variant" 2>/dev/null || echo variant-a)"
# restore the original config layout (variant-b edits it) by re-running setup's config write
bash "$HERE/setup.sh" >/dev/null
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L01 reset to $V; evidence/ untouched"
