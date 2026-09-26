#!/usr/bin/env bash
# Lab 04 inject: launch search-api and search-indexer with the probes "adjusted
# from a template".
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 04"
reset_lab 04

info "Launching search-api and search-indexer"
k apply -f "$LAB_DIR/manifests/"

say ""
say "Lab 04 injected. Symptoms take 30-90 seconds to develop (probe periods and"
say "restart back-off). Read labs/kind/04-probes/README.md for the ticket."
