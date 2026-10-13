#!/usr/bin/env bash
# L03 teardown: the beacon unit, /etc/beacon and /var/lib/beacon only.
# /opt/beacon stays (the VM baseline owns it; vm-reset.sh refreshes it).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
systemctl disable --now beacon >/dev/null 2>&1 || true
rm -f /etc/systemd/system/beacon.service
systemctl daemon-reload
rm -rf /etc/beacon /var/lib/beacon
info "removed beacon.service, /etc/beacon, /var/lib/beacon"
