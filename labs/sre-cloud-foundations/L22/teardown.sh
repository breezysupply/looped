#!/usr/bin/env bash
# L22 teardown: remove work/ only; evidence/ stays. The pinned Prometheus
# image is kept (other labs and the observability profile use it); remove it
# yourself with `docker image rm prom/prometheus:v3.5.0` if you want the space.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_workstation python3
[ -d "$WORK" ] || { info "nothing to remove"; exit 0; }
rm -rf "${WORK:?}"
info "removed $WORK (evidence/ kept)"
