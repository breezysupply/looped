#!/usr/bin/env bash
# L15 teardown: delete the L15 Deployment (and with it its ReplicaSets and
# Pods) and any L15-labelled Pods in namespace beacon, and work/. The
# namespace and the cluster stay for L16; delete the cluster with
# profiles/kind-basic/teardown.sh when you are done with M08.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
k_basic delete deployment -l "$SRE_LABEL=L15" --ignore-not-found --wait=true
k_basic delete pod -l "$SRE_LABEL=L15" --ignore-not-found --wait=true
WORK="$HERE/work"
rm -rf "${WORK:?}"
info "L15 objects removed from namespace $SRE_NS; $WORK removed; evidence/ kept"
