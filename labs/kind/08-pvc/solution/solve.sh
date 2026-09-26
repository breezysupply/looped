#!/usr/bin/env bash
# Reference fix for lab 08 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
SOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preflight >/dev/null
# storageClassName cannot be changed on an existing claim; it never bound, so
# nothing is lost by replacing it. Stop the consumer first so the claim's
# protection finalizer does not hold the delete.
k scale deployment/ledger-db --replicas=0
k wait --for=delete pod -l app=ledger-db --timeout=120s || true
k delete pvc ledger-data --wait=true --timeout=120s
k apply -f "$SOL_DIR/ledger-data-pvc.yaml"
k scale deployment/ledger-db --replicas=1
wait_rollout ledger-db 240
