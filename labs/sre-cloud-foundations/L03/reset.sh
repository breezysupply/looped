#!/usr/bin/env bash
# L03 reset: stop the unit and re-inject the same variant; notes untouched.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
[ -f /etc/systemd/system/beacon.service ] || die "nothing to reset; run setup.sh"
V="$(cat /etc/beacon/.variant 2>/dev/null || echo variant-a)"
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
