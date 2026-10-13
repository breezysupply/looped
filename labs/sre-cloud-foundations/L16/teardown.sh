#!/usr/bin/env bash
# L16 teardown: delete the L16 Deployment, Service, ConfigMap, Secret and any
# leftover L16 client pods in namespace beacon, and work/. The namespace and
# the cluster stay; profiles/kind-basic/teardown.sh deletes the cluster.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
k_basic delete deployment,service,configmap,secret -l "$SRE_LABEL=L16" --ignore-not-found --wait=true
k_basic delete pod -l "$SRE_LABEL=L16" --ignore-not-found --wait=true
WORK="$HERE/work"
rm -rf "${WORK:?}"
info "L16 objects removed from namespace $SRE_NS; $WORK removed; evidence/ kept"
