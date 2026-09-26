#!/usr/bin/env bash
# Lab 08 inject: apply the ledger manifests copied from the other environment.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 08"
reset_lab 08

info "Applying the ledger manifests"
k apply -f "$LAB_DIR/manifests/ledger-pvcs.yaml" -f "$LAB_DIR/manifests/ledger-db.yaml"

# Remember which ledger-scratch claim is the original, so verify.sh can tell
# whether it was left alone.
uid=$(k get pvc ledger-scratch -o jsonpath='{.metadata.uid}')
k apply -f - >/dev/null <<YAML
apiVersion: v1
kind: ConfigMap
metadata:
  name: lab08-state
  labels: { looped.lab/id: "08" }
data:
  ledger-scratch-uid: "$uid"
YAML

say ""
say "Lab 08 injected. Read labs/kind/08-pvc/README.md for the ticket."
