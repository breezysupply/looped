#!/usr/bin/env bash
# L17 setup: build looped-l17-beacon:1.4.0 and load it into the kind cluster looped-foundations,
# copy manifests/ to work/manifests (yours to edit), apply the baseline in namespace beacon
# (beacon-api x2 + PDB, beacon-report, PostgreSQL StatefulSet on a PVC of StorageClass
# "standard"), restore the known dataset and verify its checksum, then inject the first fault
# (LOOPED_VARIANT, default variant-a). Idempotent: an existing work/ is reused and nothing is
# re-injected.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_kind_context "$SRE_CTX_BASIC" "$SRE_KIND_BASIC"
require_workstation docker kind python3 tar
docker info >/dev/null 2>&1 || die "Docker is not reachable"

workers="$(kc_basic get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.taints[*].key}{"\n"}{end}' | awk '$2 !~ /control-plane/' | grep -c . || true)"
[ "$workers" -ge 2 ] || warn "$SRE_KIND_BASIC has $workers schedulable worker node(s); checkpoints c1–c3 work, but the drain drill (c4) needs two workers."
kc_basic get storageclass standard >/dev/null 2>&1 || die "StorageClass 'standard' (kind's default local-path provisioner) not found in $SRE_KIND_BASIC"
kc_basic apply -f - >/dev/null <<NS
apiVersion: v1
kind: Namespace
metadata:
  name: $SRE_NS
NS
others="$(k_basic get deploy,statefulset -o jsonpath='{range .items[*]}{.kind}/{.metadata.name}={.metadata.labels.looped\.lab/id}{"\n"}{end}' 2>/dev/null | grep -v '=L17$' || true)"
[ -z "$others" ] || warn "namespace $SRE_NS also holds objects from other labs: $(echo "$others" | tr '\n' ' ')— run their teardown.sh first; L17 measures scheduling and memory."

BUILD="$WORK/build"
mkdir -p "$WORK"
rm -rf "${BUILD:?}"
mkdir -p "$BUILD"
tar -C "$SRE_BEACON" --exclude=__pycache__ -cf - beacon beacon.yaml | tar -C "$BUILD" -xf -
info "building $L17_IMAGE and loading it into $SRE_KIND_BASIC"
docker build --quiet --provenance=false -t "$L17_IMAGE" -f "$HERE/assets/Dockerfile" "$BUILD" >/dev/null
kind load docker-image "$L17_IMAGE" --name "$SRE_KIND_BASIC" >/dev/null

if [ -d "$WM" ]; then
  info "work/manifests exists; reusing it (reset.sh starts over)"
  exit 0
fi
cp -R "$HERE/manifests" "$WM"
info "applying the baseline"
l17_apply 10-api.yaml 20-report.yaml 30-db.yaml 40-pdb.yaml
k_basic rollout status deploy/beacon-api --timeout=240s
k_basic rollout status deploy/beacon-report --timeout=240s
k_basic rollout status statefulset/beacon-db --timeout=300s
bash "$HERE/assets/restore-dataset.sh"

EV="$(evidence_dir "$HERE")"
{
  echo "# L17 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "nodes:"; kc_basic get nodes -o custom-columns=NAME:.metadata.name,CPU:.status.allocatable.cpu,MEMORY:.status.allocatable.memory,TAINTS:.spec.taints[*].key --no-headers
  echo "storageclass: $(kc_basic get storageclass standard -o jsonpath='{.provisioner} {.volumeBindingMode} {.reclaimPolicy}')"
  echo "db volume: $(k_basic get pvc data-beacon-db-0 -o jsonpath='{.spec.volumeName} {.status.phase}')"
} > "$EV/L17-inventory.txt"
cat "$EV/L17-inventory.txt"
[ -f "$EV/L17-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L17-notes.md"
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L17 ready. Read work/TICKETS.md; start with: kubectl --context $SRE_CTX_BASIC -n $SRE_NS get pods -o wide"
