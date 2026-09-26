#!/usr/bin/env bash
# Lab 10 inject: edge-gateway 4.1 running from an image already on the node,
# then release 4.2 applied, which names an image the node does not have and
# cannot fetch (registry.invalid never resolves: a stand-in for "no route to
# any registry"). This SIMULATES a missing dependency; it is not network isolation.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 10 (also removes a previously imported 4.2 image from the lab nodes)"
reset_lab 10

info "Deploying edge-gateway 4.1"
k apply -f "$LAB_DIR/manifests/edge-gateway-4.1.yaml"
wait_rollout edge-gateway 240

info "Applying release 4.2"
k apply -f "$LAB_DIR/manifests/edge-gateway-4.2.yaml"

say ""
say "Lab 10 injected. Read labs/kind/10-disconnected/README.md for the ticket."
say "The transfer manifest is labs/kind/10-disconnected/transfer/edge-gateway-4.2.manifest"
