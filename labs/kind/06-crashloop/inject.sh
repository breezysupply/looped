#!/usr/bin/env bash
# Lab 06 inject: notify-api 2.9.0 healthy, then release 3.0.0 is applied
# without the ConfigMap it expects.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 06"
reset_lab 06

info "Deploying notify-api 2.9.0"
k apply -f "$LAB_DIR/manifests/notify-api-2.9.0.yaml"
wait_rollout notify-api 240

info "Releasing notify-api 3.0.0"
k apply -f "$LAB_DIR/manifests/notify-api-3.0.0.yaml"

say ""
say "Lab 06 injected. CrashLoopBackOff appears after the first few restarts"
say "(about a minute). Read labs/kind/06-crashloop/README.md for the ticket."
