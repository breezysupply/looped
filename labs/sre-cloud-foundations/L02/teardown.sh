#!/usr/bin/env bash
# L02 teardown: remove /opt/beacon-l02 only. Notes and evidence in the
# course repository stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l02
pkill -f "beacon api --config /tmp/looped-l02-" >/dev/null 2>&1 || true
rm -rf "${LAB:?}"
info "removed $LAB"
