#!/usr/bin/env bash
# L21 reset: stop looped-l21, keep your work/ as .work-previous/, start over
# from the starter for the same variant (or LOOPED_VARIANT). The observability
# profile keeps running; its old series age out (retention 1 day).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L21_PROJECT"
l21_guard
V="$(l21_variant)"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
l21_dc down --remove-orphans >/dev/null 2>&1 || true
PREV="$HERE/.work-previous"
if [ -d "$WORK" ]; then
  rm -rf "${PREV:?}"
  mv "$WORK" "$PREV"
  rm -rf "${PREV:?}/queue"
fi
LOOPED_VARIANT="$V" bash "$HERE/setup.sh"
info "L21 reset to $V; your previous work is in .work-previous/"
