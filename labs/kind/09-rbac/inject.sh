#!/usr/bin/env bash
# Lab 09 inject: stock-sync as it is after last week's namespace migration.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 09"
reset_lab 09

info "Applying stock-sync, its ServiceAccount, Role, RoleBinding and data"
k apply -f "$LAB_DIR/manifests/rbac.yaml" -f "$LAB_DIR/manifests/stock-data.yaml" -f "$LAB_DIR/manifests/stock-sync.yaml"
wait_rollout stock-sync 240

say ""
say "Lab 09 injected. Read labs/kind/09-rbac/README.md for the ticket."
