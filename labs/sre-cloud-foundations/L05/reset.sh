#!/usr/bin/env bash
# L05 reset: restore the zone files, routes and caches for the same variant
# (or LOOPED_VARIANT) by re-running inject.sh. Notes in evidence/ stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l05
V="$(cat "$LAB/.lab/variant" 2>/dev/null || echo variant-a)"
ip netns list | grep -qw looped-l05-srv || die "namespaces missing; run setup.sh"
printf 'nameserver 10.55.2.10\nsearch corp.lab\noptions timeout:2 attempts:1\n' > /etc/netns/looped-l05-client/resolv.conf
printf '127.0.0.1 localhost\n' > /etc/netns/looped-l05-client/hosts
LOOPED_VARIANT="${LOOPED_VARIANT:-$V}" bash "$HERE/inject.sh"
info "L05 reset to ${LOOPED_VARIANT:-$V}; evidence/ untouched"
