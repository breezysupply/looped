#!/usr/bin/env bash
# L25 reset: remove this lab's containers, volume, images and work/ (keeping
# copies of your triage, notes-relevant files and lock in .work-previous/),
# then set up the same variant again (or LOOPED_VARIANT). New synthetic
# secrets are generated; evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l25_guard
V="$(l25_variant)"
PREV="$HERE/.work-previous"
if [ -d "$WORK" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  for f in patch/triage.json patch/report/requirements.txt patch/sbom.cdx.json; do
    [ -f "$WORK/$f" ] && cp "$WORK/$f" "$PREV/$(basename "$f")"
  done
fi
LOOPED_KEEP_PREVIOUS=1 bash "$HERE/teardown.sh"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L25 reset to ${LOOPED_VARIANT:-$V}; your previous triage/lock/SBOM are in .work-previous/"
