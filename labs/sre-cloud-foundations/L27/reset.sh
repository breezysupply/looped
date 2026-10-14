#!/usr/bin/env bash
# L27 reset: remove project looped-l27 (with its synthetic data volume) and
# work/ (your limits.env, client.env and runs/ are copied to .work-previous/),
# then set up the same variant again (or LOOPED_VARIANT), baseline run included.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L27_PROJECT"
l27_guard
V="$(l27_variant)"
PREV="$HERE/.work-previous"
if [ -d "$WORK" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp "$WORK"/limits.env "$WORK"/client.env "$PREV/" 2>/dev/null || true
  [ -d "$WORK/runs" ] && cp -R "$WORK/runs" "$PREV/runs"
fi
LOOPED_KEEP_PREVIOUS=1 bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L27 reset to ${LOOPED_VARIANT:-$V}; your previous limits, policy and runs are in .work-previous/"
