#!/usr/bin/env bash
# L28 reset: remove project looped-l28 (both lab volumes included) and work/
# (your updates and follow-ups are copied to .work-previous/), then set up the
# same variant again (or LOOPED_VARIANT). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L28_PROJECT"
l28_guard
V="$(l28_variant)"
PREV="$HERE/.work-previous"
if [ -d "$WORK/incident" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp -R "$WORK/incident" "$PREV/incident"
fi
LOOPED_KEEP_PREVIOUS=1 bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L28 reset to ${LOOPED_VARIANT:-$V}; your previous incident files are in .work-previous/"
