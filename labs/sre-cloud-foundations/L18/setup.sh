#!/usr/bin/env bash
# L18 setup (profile kind-policy): check that Calico runs, build looped-l18-beacon:1.4.0 and load
# it into the kind cluster looped-policy, copy manifests/ to work/manifests (yours to edit),
# inject the variant, apply the workloads and the deploy bot's RBAC (NOT the NetworkPolicies:
# that is checkpoint c2), and run the deploy bot once into work/deploy-bot.log.
# Idempotent: an existing work/ is reused.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_POLICY" "$SRE_KIND_POLICY"
require_workstation docker kind python3 tar
docker info >/dev/null 2>&1 || die "Docker is not reachable"
ready="$(kc_policy -n kube-system get ds calico-node -o jsonpath='{.status.numberReady}/{.status.desiredNumberScheduled}' 2>/dev/null || true)"
case "$ready" in ""|0/*) die "Calico is not running in $SRE_KIND_POLICY (calico-node '$ready'). Run profiles/kind-policy/setup.sh." ;; esac
if kc_policy -n kube-system get pods -l app=kindnet -o name 2>/dev/null | grep -q .; then
  die "kindnet runs in $SRE_KIND_POLICY; this is not the kind-policy profile's cluster"
fi
kc_policy apply -f - >/dev/null <<NS
apiVersion: v1
kind: Namespace
metadata:
  name: $SRE_NS
NS

BUILD="$WORK/build"
mkdir -p "$WORK"
rm -rf "${BUILD:?}"
mkdir -p "$BUILD"
tar -C "$SRE_BEACON" --exclude=__pycache__ -cf - beacon beacon.yaml | tar -C "$BUILD" -xf -
info "building $L18_IMAGE and loading it into $SRE_KIND_POLICY"
docker build --quiet --provenance=false -t "$L18_IMAGE" -f "$HERE/assets/Dockerfile" "$BUILD" >/dev/null
kind load docker-image "$L18_IMAGE" --name "$SRE_KIND_POLICY" >/dev/null

if [ -d "$WM" ]; then
  info "work/manifests exists; reusing it (reset.sh starts over)"
  exit 0
fi
cp -R "$HERE/manifests" "$WM"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
k_policy apply -f "$WM/10-workloads.yaml" >/dev/null
k_policy apply -f "$WM/20-rbac.yaml" >/dev/null
for d in beacon-db beacon-api beacon-report; do k_policy rollout status "deploy/$d" --timeout=240s; done

EV="$(evidence_dir "$HERE")"
{
  echo "# L18 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "cni: calico-node $ready ready; kindnet absent"
  echo "nodes: $(kc_policy get nodes -o jsonpath='{range .items[*]}{.metadata.name}={.status.nodeInfo.kubeletVersion} {end}')"
} > "$EV/L18-inventory.txt"
cat "$EV/L18-inventory.txt"
[ -f "$EV/L18-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L18-notes.md"
info "running the deploy bot once (its log is the c1 ticket's evidence)"
bash "$HERE/assets/deploy-bot.sh" > "$WORK/deploy-bot.log" 2>&1 || true
say ""
say "L18 ready. Read $WORK/TICKETS.md and $WORK/deploy-bot.log."
