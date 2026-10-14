#!/usr/bin/env bash
# L26 reset: recreate both environments from scratch for the same variant
# (or LOOPED_VARIANT): teardown.sh, then setup.sh. A NEW release key is
# generated, so the trust bootstrap starts over too. Your TRUST-BOOTSTRAP.md
# and verify log are copied to .work-previous/ first; evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L26_PROJECT"
l26_guard
V="$(l26_variant)"
PREV="$HERE/.work-previous"
if [ -d "$WORK/receiver" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp "$WORK/receiver/TRUST-BOOTSTRAP.md" "$WORK/receiver/verify-log.jsonl" "$PREV/" 2>/dev/null || true
fi
LOOPED_KEEP_PREVIOUS=1 bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L26 reset to ${LOOPED_VARIANT:-$V}; previous trust notes and verify log are in .work-previous/"
