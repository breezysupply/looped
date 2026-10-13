#!/usr/bin/env bash
# L20 teardown: delete L20's objects in namespace beacon of looped-foundations (label
# looped.lab/id=L20) and the lab images on the kind nodes (if the cluster is there), stop and
# remove the registry container looped-l20-registry and its volume looped-l20-registry-data,
# remove images looped-l20-beacon:* and 127.0.0.1:5020/looped-l20/beacon:*, delete work/ (both
# git repositories, CI records, reconciler state). The shared registry:2.8.3 and python base
# images are kept. evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L20_PROJECT"
if kubectl --context "$SRE_CTX_BASIC" config view --minify >/dev/null 2>&1 && kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_BASIC"; then
  require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
  k_basic delete deployment,service,configmap,secret -l "$SRE_LABEL=L20" --wait=true >/dev/null
  for node in $(kind get nodes --name "$SRE_KIND_BASIC" 2>/dev/null); do
    for img in $(docker exec "$node" crictl images -o json 2>/dev/null | python3 -c 'import json,sys
for i in json.load(sys.stdin).get("images", []):
    for t in i.get("repoTags") or []:
        if "/looped-l20-beacon:" in t: print(t)' 2>/dev/null || true); do
      docker exec "$node" crictl rmi "$img" >/dev/null 2>&1 || true
    done
  done
else
  warn "cluster $SRE_KIND_BASIC not reachable; removing only the Docker objects and work/"
fi
if docker inspect "$L20_REGISTRY_NAME" >/dev/null 2>&1; then docker rm -f -v "$L20_REGISTRY_NAME" >/dev/null; fi
if docker volume inspect "$L20_REGISTRY_VOLUME" >/dev/null 2>&1; then docker volume rm "$L20_REGISTRY_VOLUME" >/dev/null; fi
imgs="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^($L20_LOCAL|127\.0\.0\.1:5020/looped-l20/beacon):" || true)"
for i in $imgs; do docker image rm "$i" >/dev/null 2>&1 || true; done
for d in "$WORK" "$HERE/.work-previous"; do
  if [ -d "$d" ]; then rm -rf "${d:?}"; fi
done
left="$(docker ps -a --filter "name=^looped-l20-" -q; docker volume ls -q --filter "name=^looped-l20-"; docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^($L20_LOCAL|127\.0\.0\.1:5020/looped-l20/beacon):" || true)"
[ -z "$left" ] || die "still present: $left"
info "L20 removed: no looped-l20-* containers, volumes or images; evidence/ kept"
