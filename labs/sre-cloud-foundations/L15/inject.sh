#!/usr/bin/env bash
# L15 fault injection. Rebuilds the baseline (Deployment from manifests/,
# rolled out), refreshes work/deployment.yaml, then applies the variant.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
# Only Deployments/Pods labelled looped.lab/id=L15 or L16 in namespace beacon
# are touched (L16 uses the same Deployment name).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

info "baseline: removing previous L15/L16 Deployments and pods in namespace $SRE_NS (same Deployment name)"
k_basic delete deployment -l "$SRE_LABEL in (L15,L16)" --ignore-not-found --wait=true
k_basic delete pod -l "$SRE_LABEL in (L15,L16)" --ignore-not-found --wait=true
WORK="$HERE/work"
rm -rf "${WORK:?}"
mkdir -p "$WORK"
cp "$HERE/manifests/deployment.yaml" "$WORK/deployment.yaml"
printf '%s\n' "$V" > "$WORK/.variant"
k_basic apply -f "$WORK/deployment.yaml"
k_basic rollout status deployment/beacon --timeout=180s

case "$V" in
  variant-a)
    # someone "saved resources" on the shared cluster, out of band
    k_basic scale deployment/beacon --replicas=1
    ;;
  variant-b)
    # a colleague's half-finished edit of CR-1042, left in your working copy
    python3 - "$WORK/deployment.yaml" <<'PY'
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
old_sel = "    matchLabels:\n      app.kubernetes.io/name: beacon\n"
old_tpl = "      labels:\n        app.kubernetes.io/name: beacon\n        looped.lab/id: L15\n"
assert old_sel in s and old_tpl in s
s = s.replace(old_sel, old_sel + "      tier: api\n", 1)
s = s.replace(old_tpl, old_tpl + "        tier: api\n", 1)
open(p, "w", encoding="utf-8").write(s)
PY
    ;;
  variant-c)
    # maintenance window left half-closed
    k_basic rollout pause deployment/beacon
    ;;
esac
info "fault injected ($V)"
