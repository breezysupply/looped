#!/usr/bin/env bash
# L06 reset: re-issue the variant's certificates, rewrite proxy.json and restart
# the proxy for the same variant (or LOOPED_VARIANT). The CAs, Beacon and your
# notes stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l06
V="$(cat "$LAB/.lab/variant" 2>/dev/null || echo variant-a)"
if [ "$(sha256sum "$LAB/ca/ca.pem" | cut -d' ' -f1)" != "$(cat "$LAB/.lab/ca.sha256")" ]; then
  warn "the lab CA file was modified; rebuilding the whole lab"
  LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/setup.sh"; exit 0
fi
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L06 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
