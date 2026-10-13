#!/usr/bin/env bash
# L19 reset: uninstall this lab's Helm release (only if it is L19's), keep your chart edits in
# .work-previous/chart, rebuild work/ and write the ticket again for the same variant (or
# LOOPED_VARIANT). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
require_workstation helm
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
case "$(l19_release_state)" in
  ours) info "uninstalling release $L19_RELEASE"; h_basic uninstall "$L19_RELEASE" --wait >/dev/null ;;
  foreign) die "release $L19_RELEASE in $SRE_NS is not this lab's; leaving it alone" ;;
  *) : ;;
esac
k_basic delete pod -l "app.kubernetes.io/instance=$L19_RELEASE,$SRE_LABEL=L19" --ignore-not-found >/dev/null
PREV="$HERE/.work-previous"
if [ -d "$WORK/chart" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp -R "$WORK/chart" "$PREV/chart"
fi
rm -rf "${WORK:?}"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L19 reset to ${LOOPED_VARIANT:-$V}; your previous chart is in .work-previous/chart"
