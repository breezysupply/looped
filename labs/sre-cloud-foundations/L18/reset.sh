#!/usr/bin/env bash
# L18 reset: delete every L18 object in namespace beacon of looped-policy (label
# looped.lab/id=L18: workloads, ServiceAccounts, Role/RoleBinding, NetworkPolicies, Secret),
# keep your manifests in .work-previous/manifests, then set up again for the same variant
# (or LOOPED_VARIANT). evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
V="$(cat "$WORK/.variant" 2>/dev/null || echo variant-a)"
PREV="$HERE/.work-previous"
if [ -d "$WM" ]; then
  rm -rf "${PREV:?}"
  mkdir -p "$PREV"
  cp -R "$WM" "$PREV/manifests"
  cp "$WORK/deploy-bot.log" "$PREV/" 2>/dev/null || true
fi
k_policy delete networkpolicy,deployment,service,secret,serviceaccount,rolebinding,role -l "$SRE_LABEL=L18" --wait=true >/dev/null
rm -rf "${WORK:?}"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"
info "L18 reset to ${LOOPED_VARIANT:-$V}; your previous manifests are in .work-previous/manifests"
