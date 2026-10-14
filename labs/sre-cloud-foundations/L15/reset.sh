#!/usr/bin/env bash
# L15 reset: rebuild the baseline and re-inject the same variant (or
# LOOPED_VARIANT). work/ is replaced; evidence/ is kept. Namespace-scoped.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
V="$(cat "$HERE/work/.variant" 2>/dev/null || echo variant-a)"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L15 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
