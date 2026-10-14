#!/usr/bin/env bash
# L16 fault injection: fresh work/ from manifests/, the variant applied to
# work/, then everything applied from scratch (previous L15/L16 Deployment,
# Service, ConfigMap, Secret removed first, by label, in namespace beacon).
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac

info "baseline: removing previous L15/L16 objects in namespace $SRE_NS"
k_basic delete deployment,service,configmap,secret -l "$SRE_LABEL in (L15,L16)" --ignore-not-found --wait=true
k_basic delete pod -l "$SRE_LABEL in (L15,L16)" --ignore-not-found --wait=true
WORK="$HERE/work"
rm -rf "${WORK:?}"
mkdir -p "$WORK"
cp "$HERE"/manifests/*.yaml "$WORK/"
printf '%s\n' "$V" > "$WORK/.variant"

python3 - "$WORK" "$V" <<'PY'
import os, sys
work, v = sys.argv[1], sys.argv[2]
def edit(name, old, new):
    p = os.path.join(work, name)
    s = open(p, encoding="utf-8").read()
    assert old in s, (name, old)
    open(p, "w", encoding="utf-8").write(s.replace(old, new, 1))
if v == "variant-a":
    edit("service.yaml", "    app.kubernetes.io/component: api\n", "    app.kubernetes.io/component: beacon-api\n")
elif v == "variant-b":
    edit("service.yaml", "      targetPort: http\n", "      targetPort: 8081\n")
elif v == "variant-c":
    edit("deployment.yaml", "              path: /ready\n", "              path: /readyz\n")
PY

kc_basic apply -f "$WORK/"
if [ "$V" != variant-c ]; then
  k_basic rollout status deployment/beacon --timeout=180s
else
  sleep 5
fi
info "fault injected ($V)"
