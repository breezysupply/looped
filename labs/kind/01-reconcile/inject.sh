#!/usr/bin/env bash
# Lab 01 inject: start catalog (Deployment, 3 replicas) and a hand-made
# catalog-debug Pod, then replay the overnight action: delete every catalog
# pod and the catalog-debug pod.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 01"
reset_lab 01

info "Applying the healthy starting state"
k apply -f "$LAB_DIR/manifests/"
wait_rollout catalog 240
k wait --for=condition=Ready pod/catalog-debug --timeout=240s >/dev/null

before=$(k get pods -l app=catalog -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}')
at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
info "Replaying the overnight action at $at: deleting pods $before catalog-debug"
k delete pod -l app=catalog --wait=false
k delete pod catalog-debug --wait=false

# The incident channel's record of what was deleted, for your notes.
k apply -f - >/dev/null <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: lab01-incident-notes
  labels: { looped.lab/id: "01" }
data:
  deleted-at: "$at"
  deleted-pods: "$before catalog-debug"
YAML

say ""
say "Lab 01 injected. Read labs/kind/01-reconcile/README.md for the ticket."
say "The names of the deleted pods are in ConfigMap lab01-incident-notes."
