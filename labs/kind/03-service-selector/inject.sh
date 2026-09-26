#!/usr/bin/env bash
# Lab 03 inject: orders-api + storefront working, then the "label cleanup"
# version of the orders Service is applied.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 03"
reset_lab 03

info "Deploying orders-api, the orders Service (previous version) and storefront"
k apply -f "$LAB_DIR/manifests/orders-api.yaml" -f "$LAB_DIR/manifests/orders-service-before.yaml" -f "$LAB_DIR/manifests/storefront.yaml"
wait_rollout orders-api 240
wait_rollout storefront 240
storefront_ok() { k logs deployment/storefront --tail=1 2>/dev/null | grep -q -- '-> orders-api ok'; }
wait_until 90 "storefront to reach orders" storefront_ok || die "storefront never reached orders before the change; check the cluster"

info "Applying this morning's change to the orders Service"
k apply -f "$LAB_DIR/manifests/orders-service.yaml"

say ""
say "Lab 03 injected. Read labs/kind/03-service-selector/README.md for the ticket."
