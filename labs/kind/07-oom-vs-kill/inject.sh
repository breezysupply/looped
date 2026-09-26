#!/usr/bin/env bash
# Lab 07 inject: start thumbnailer and transcoder as they are after
# yesterday's changes.
set -euo pipefail
. "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lib/common.sh"
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

preflight
info "Resetting lab 07"
reset_lab 07

info "Starting thumbnailer and transcoder"
k apply -f "$LAB_DIR/manifests/"

say ""
say "Lab 07 injected. Both workloads need 30-90 seconds before their first"
say "termination shows up. Read labs/kind/07-oom-vs-kill/README.md for the ticket."
