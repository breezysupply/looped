#!/usr/bin/env bash
# kind-basic profile setup: create ONLY the kind cluster looped-foundations
# from kind-config.yaml (pinned node image), create namespace beacon, build
# the Beacon image and load it into the nodes. Idempotent: an existing
# cluster of that name is reused. Your current kubectl context is restored
# afterwards; every lab passes --context kind-looped-foundations explicitly.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
for t in docker kind kubectl python3; do command -v "$t" >/dev/null 2>&1 || die "$t not found (see README.md for the pinned versions)"; done
docker info >/dev/null 2>&1 || die "Docker is not reachable; start Docker Desktop / colima"
kv="$(kind version 2>/dev/null | awk '{print $2}')"
case "$kv" in v0.29.*) ;; *) warn "kind $kv: this profile was written for kind v0.29.0 (node image v1.33.1); other versions may need a different node image" ;; esac

prev="$(kubectl config current-context 2>/dev/null || true)"
if kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_BASIC"; then
  info "cluster $SRE_KIND_BASIC exists; reusing it"
else
  info "kind create cluster --name $SRE_KIND_BASIC --config kind-config.yaml"
  kind create cluster --name "$SRE_KIND_BASIC" --config "$HERE/kind-config.yaml" --wait 180s
fi
if [ -n "$prev" ] && [ "$prev" != "$SRE_CTX_BASIC" ]; then
  kubectl config use-context "$prev" >/dev/null && info "kubectl current-context restored to $prev"
fi

require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
kc_basic apply -f "$HERE/namespace.yaml"
bash "$HERE/build-image.sh"

say ""
kc_basic get nodes -o wide
say ""
say "kind-basic ready: context $SRE_CTX_BASIC, namespace $SRE_NS, image registry.lab/beacon:1.4.0 loaded."
say "Every command in the labs names the context: kubectl --context $SRE_CTX_BASIC -n $SRE_NS ..."
