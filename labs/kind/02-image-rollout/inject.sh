#!/usr/bin/env bash
# Lab 02 inject: payments-api 2.7.0 healthy, then release 2.8.0 is applied.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 02"
reset_lab 02

info "Deploying payments-api 2.7.0"
k apply -f "$LAB_DIR/manifests/service.yaml" -f "$LAB_DIR/manifests/payments-api-2.7.0.yaml"
wait_rollout payments-api 240

info "Releasing payments-api 2.8.0 (the pipeline would now wait for the rollout)"
k apply -f "$LAB_DIR/manifests/payments-api-2.8.0.yaml"

say ""
say "Lab 02 injected. Read labs/kind/02-image-rollout/README.md for the ticket."
