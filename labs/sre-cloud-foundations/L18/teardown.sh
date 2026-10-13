#!/usr/bin/env bash
# L18 teardown: delete every L18 object in namespace beacon of looped-policy (label
# looped.lab/id=L18), remove looped-l18-beacon:1.4.0 from the kind nodes and Docker, delete
# work/ and .work-previous/. The policy cluster itself stays: profiles/kind-policy/teardown.sh
# deletes it. evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
k_policy delete networkpolicy,deployment,service,secret,serviceaccount,rolebinding,role -l "$SRE_LABEL=L18" --wait=true >/dev/null
for node in $(kind get nodes --name "$SRE_KIND_POLICY" 2>/dev/null); do
  docker exec "$node" crictl rmi "docker.io/library/$L18_IMAGE" >/dev/null 2>&1 || true
done
docker image rm "$L18_IMAGE" >/dev/null 2>&1 || true
for d in "$WORK" "$HERE/.work-previous"; do
  if [ -d "$d" ]; then rm -rf "${d:?}"; fi
done
left="$(k_policy get networkpolicy,deployment,serviceaccount,role,rolebinding -l "$SRE_LABEL=L18" -o name 2>/dev/null || true)"
[ -z "$left" ] || die "still present in $SRE_NS: $left"
info "L18 removed from $SRE_KIND_POLICY; evidence/ kept"
