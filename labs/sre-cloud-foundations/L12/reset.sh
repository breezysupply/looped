#!/usr/bin/env bash
# L12 reset: tear down this lab's Docker objects and state (teardown.sh),
# keeping a copy of your .tf files in .work-previous/, then set up again for
# the same variant (or LOOPED_VARIANT).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/assets/common.sh"
l12_guard
PREV="$HERE/.work-previous"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
if [ -d "$WORK" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  (cd "$WORK" && find . -path '*/.terraform' -prune -o \( -name '*.tf' -o -name '*.tfvars' -o -name 'README.md' \) -print | while read -r f; do mkdir -p "$PREV/$(dirname "$f")"; cp "$f" "$PREV/$f"; done)
fi
LOOPED_KEEP_PREVIOUS=1 bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L12 reset to ${LOOPED_VARIANT:-$V}; your previous .tf files are in .work-previous/"
