#!/usr/bin/env bash
# profiles/kind-policy teardown: delete ONLY the kind cluster named looped-policy (and the
# kubeconfig context kind created for it). Asks first unless LOOPED_YES=1. Lab evidence in the
# repository is kept; the cached Calico manifest is kept (pass LOOPED_PURGE_CACHE=1 to remove it).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
. "$HERE/versions.env"
require_workstation kind docker
if ! kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_POLICY"; then
  say "kind cluster $SRE_KIND_POLICY does not exist; nothing to do"
  exit 0
fi
confirm "Delete the kind cluster '$SRE_KIND_POLICY' (L18's policy cluster)?"
kind delete cluster --name "$SRE_KIND_POLICY"
if [ "${LOOPED_PURGE_CACHE:-0}" = 1 ]; then
  rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/looped/calico-$CALICO_VERSION.yaml"
fi
say "deleted $SRE_KIND_POLICY"
