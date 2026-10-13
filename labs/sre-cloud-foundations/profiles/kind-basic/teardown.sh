#!/usr/bin/env bash
# kind-basic profile teardown: delete ONLY the kind cluster looped-foundations
# (its node containers and its kubeconfig context), the profile's Beacon image
# (label looped.lab/id=kind-basic) and the .build directory. The kindest/node
# image stays cached. Asks first unless LOOPED_YES=1.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
command -v kind >/dev/null 2>&1 || die "kind not found"
if kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_BASIC"; then
  confirm "Delete the kind cluster '$SRE_KIND_BASIC' (all lab namespaces in it)? Evidence in the repository is kept."
  kind delete cluster --name "$SRE_KIND_BASIC"
else
  say "cluster $SRE_KIND_BASIC does not exist; nothing to delete"
fi
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  imgs="$(docker images -q --filter "label=$SRE_LABEL=kind-basic" | sort -u)"
  [ -z "$imgs" ] || docker rmi -f $imgs >/dev/null
fi
B="$HERE/.build"
rm -rf "${B:?}"
info "kind-basic removed: cluster $SRE_KIND_BASIC, image registry.lab/beacon:1.4.0, $B"
