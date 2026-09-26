#!/usr/bin/env bash
# Reference fix for lab 01 (used by the harness). Try the lab before reading this.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/lib/common.sh"
SOL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
preflight >/dev/null
# catalog needs nothing: its ReplicaSet already replaced the deleted pods.
k apply -f "$SOL_DIR/catalog-debug-deployment.yaml"
wait_rollout catalog-debug 180
