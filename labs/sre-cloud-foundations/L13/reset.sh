#!/usr/bin/env bash
# L13 reset: rebuild work/ from starter/ and re-inject the same variant (or
# LOOPED_VARIANT). Your notes in evidence/ are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_compose_project looped-l13
V="$(cat "$HERE/work/.variant" 2>/dev/null || echo variant-a)"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L13 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
