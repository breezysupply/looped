#!/usr/bin/env bash
# Lab 05 inject: report-builder 1.4.0 healthy, then release 1.5.0 is applied.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 05"
reset_lab 05

info "Deploying report-builder 1.4.0"
k apply -f "$LAB_DIR/manifests/report-builder-1.4.0.yaml"
wait_rollout report-builder 240

info "Releasing report-builder 1.5.0"
k apply -f "$LAB_DIR/manifests/report-builder-1.5.0.yaml"

say ""
say "Lab 05 injected. Read labs/kind/05-pending/README.md for the ticket."
