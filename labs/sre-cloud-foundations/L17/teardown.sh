#!/usr/bin/env bash
# L17 teardown: uncordon any looped-foundations node left cordoned, delete every L17 object in
# namespace beacon (label looped.lab/id=L17, including the database PVC and so its data), remove
# looped-l17-beacon:1.4.0 from the kind nodes and Docker, delete work/ and .work-previous/.
# The namespace and the cluster stay (profiles/kind-basic/teardown.sh removes the cluster).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
for n in $(kc_basic get nodes -o jsonpath='{range .items[?(@.spec.unschedulable==true)]}{.metadata.name}{"\n"}{end}'); do
  kc_basic uncordon "$n" >/dev/null && say "uncordoned $n"
done
k_basic delete statefulset,deployment,service,configmap,secret,poddisruptionbudget -l "$SRE_LABEL=L17" --wait=true >/dev/null
k_basic delete pvc -l "$SRE_LABEL=L17" --wait=true >/dev/null
k_basic delete pvc data-beacon-db-0 --ignore-not-found --wait=true >/dev/null
for node in $(kind get nodes --name "$SRE_KIND_BASIC" 2>/dev/null); do
  docker exec "$node" crictl rmi "docker.io/library/$L17_IMAGE" >/dev/null 2>&1 || true
done
docker image rm "$L17_IMAGE" >/dev/null 2>&1 || true
for d in "$WORK" "$HERE/.work-previous"; do
  if [ -d "$d" ]; then rm -rf "${d:?}"; fi
done
left="$(k_basic get all,pvc -l "$SRE_LABEL=L17" -o name 2>/dev/null || true)"
[ -z "$left" ] || die "still present in $SRE_NS: $left"
info "L17 removed: no L17 objects or PVCs in $SRE_NS; evidence/ kept"
