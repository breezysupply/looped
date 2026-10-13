#!/usr/bin/env bash
# profiles/kind-policy setup: create the kind cluster looped-policy with kind's default CNI
# disabled, install Calico from a pinned manifest verified by SHA-256, wait for nodes, Calico and
# CoreDNS, create the beacon namespace, then PROVE enforcement with selftest.sh (allow → deny →
# selective allow). A manifest being accepted is not enforcement; the self-test is.
#
# Idempotent: an existing looped-policy cluster is checked and completed, never recreated.
# Touches only the kind cluster named looped-policy, its kubeconfig context (added by kind) and
# a cached copy of the Calico manifest under ${XDG_CACHE_HOME:-~/.cache}/looped/.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../../lib/looped.sh"
. "$HERE/versions.env"
require_workstation docker kind kubectl curl
docker info >/dev/null 2>&1 || die "Docker is not reachable; start Docker Desktop / colima first"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

kv="$(kind version 2>/dev/null | awk '{print $2}')"
[ "$kv" = "$KIND_VERSION_TESTED" ] || warn "kind $kv found; this profile was written against $KIND_VERSION_TESTED (node image pinned in kind-config.yaml)"

prev="$(kubectl config current-context 2>/dev/null || true)"
if kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_POLICY"; then
  info "kind cluster $SRE_KIND_POLICY exists; checking it instead of recreating"
else
  if kind get clusters 2>/dev/null | grep -qx "$SRE_KIND_BASIC"; then
    warn "the core cluster $SRE_KIND_BASIC is also running. Two clusters need ~6 GiB; stop it with profiles/kind-basic/teardown.sh if Docker is short of memory."
  fi
  info "creating kind cluster $SRE_KIND_POLICY (default CNI disabled; nodes stay NotReady until Calico is installed)"
  kind create cluster --name "$SRE_KIND_POLICY" --config "$HERE/kind-config.yaml" --wait 0s
fi
# kind create switches the current context; nothing in the course relies on it, so put it back
if [ -n "$prev" ] && [ "$prev" != "$SRE_CTX_POLICY" ]; then
  kubectl config use-context "$prev" >/dev/null && info "kubectl current-context restored to $prev"
fi
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"

if kc_policy -n kube-system get pods -l app=kindnet -o name 2>/dev/null | grep -q .; then
  die "kindnet pods are running in $SRE_KIND_POLICY, so it was not created from this profile's kind-config.yaml. Run teardown.sh, then setup.sh."
fi

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/looped"
mkdir -p "$CACHE"
manifest="$CACHE/calico-$CALICO_VERSION.yaml"
if [ ! -f "$manifest" ]; then
  info "downloading Calico $CALICO_VERSION manifest"
  curl -fsSL --retry 3 -o "$manifest.part" "$CALICO_MANIFEST_URL" || die "download failed: $CALICO_MANIFEST_URL"
  mv "$manifest.part" "$manifest"
fi
got="$(sha256_of "$manifest")"
if [ "$got" != "$CALICO_MANIFEST_SHA256" ]; then
  rm -f "$manifest"
  die "Calico manifest checksum mismatch (got $got, expected $CALICO_MANIFEST_SHA256); refusing to apply it"
fi
info "Calico $CALICO_VERSION manifest verified (sha256 $got); applying (server-side: the CRDs are too large for client-side apply)"
kc_policy apply --server-side --force-conflicts -f "$manifest" >/dev/null
# Felix refuses to start when the node's rp_filter is "loose", which some Docker hosts set inside
# kind nodes. Telling it to ignore that is the documented kind workaround; harmless otherwise.
kc_policy -n kube-system set env daemonset/calico-node FELIX_IGNORELOOSERPF=true >/dev/null
kc_policy -n kube-system rollout status daemonset/calico-node --timeout=420s
kc_policy -n kube-system rollout status deployment/calico-kube-controllers --timeout=300s
kc_policy wait --for=condition=Ready node --all --timeout=240s
kc_policy -n kube-system rollout status deployment/coredns --timeout=240s

kc_policy apply -f - >/dev/null <<NS
apiVersion: v1
kind: Namespace
metadata:
  name: $SRE_NS
  labels:
    looped.lab/profile: kind-policy
    # same Pod Security level as the kind-basic profile: L18's pods run unprivileged
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.33
NS

say ""
say "cluster:   $SRE_KIND_POLICY (context $SRE_CTX_POLICY)"
say "nodes:     $(kc_policy get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.nodeInfo.kubeletVersion} {end}')"
say "CNI:       Calico $CALICO_VERSION ($(kc_policy -n kube-system get ds calico-node -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}') calico-node ready); kindnet absent"
if [ "${LOOPED_SKIP_SELFTEST:-0}" = 1 ]; then
  warn "LOOPED_SKIP_SELFTEST=1: enforcement NOT proven; run selftest.sh before L18"
else
  bash "$HERE/selftest.sh"
fi
say "kind-policy ready. Next: labs/sre-cloud-foundations/L18/setup.sh"
