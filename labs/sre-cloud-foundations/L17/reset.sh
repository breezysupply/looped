#!/usr/bin/env bash
# L17 reset: remove every L17 object in namespace beacon (label looped.lab/id=L17, including the
# database PVC), keep your manifests in .work-previous/manifests, then set up the baseline again
# and inject LOOPED_VARIANT (default variant-a). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
PREV="$HERE/.work-previous"
if [ -d "$WM" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp -R "$WM" "$PREV/manifests"
fi
k_basic delete statefulset,deployment,service,configmap,secret,poddisruptionbudget -l "$SRE_LABEL=L17" --wait=true >/dev/null
k_basic delete pvc -l "$SRE_LABEL=L17" --wait=true >/dev/null
k_basic delete pvc data-beacon-db-0 --ignore-not-found --wait=true >/dev/null
rm -rf "${WORK:?}"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/setup.sh"
info "L17 reset; your previous manifests are in .work-previous/manifests"
