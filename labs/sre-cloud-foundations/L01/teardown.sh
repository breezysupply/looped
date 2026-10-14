#!/usr/bin/env bash
# L01 teardown: remove /opt/beacon-l01 only. Evidence in the repository stays.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
pkill -f "python3 -m beacon api --config config/beacon.yaml" >/dev/null 2>&1 || true
rm -rf /opt/beacon-l01
info "removed /opt/beacon-l01"
