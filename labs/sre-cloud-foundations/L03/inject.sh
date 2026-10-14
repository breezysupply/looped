#!/usr/bin/env bash
# L03 fault injection.
#   variant-a  ExecStart/WorkingDirectory wrong: the unit starts python in
#              /opt (not /opt/beacon), so `-m beacon` is not found
#   variant-b  /etc/beacon/beacon.yaml owned root:root mode 600: the beacon
#              user gets permission denied
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
[ -f /etc/systemd/system/beacon.service ] || die "run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V" ;; esac
systemctl stop beacon >/dev/null 2>&1 || true
systemctl reset-failed beacon >/dev/null 2>&1 || true
# baseline first
cp "$SRE_BEACON/beacon.service" /etc/systemd/system/beacon.service
chown root:beacon /etc/beacon/beacon.yaml && chmod 640 /etc/beacon/beacon.yaml
if [ "$V" = variant-a ]; then
  sed -i 's#^WorkingDirectory=/opt/beacon$#WorkingDirectory=/opt#' /etc/systemd/system/beacon.service
else
  chown root:root /etc/beacon/beacon.yaml && chmod 600 /etc/beacon/beacon.yaml
fi
systemctl daemon-reload
printf '%s\n' "$V" > /etc/beacon/.variant
chmod 644 /etc/beacon/.variant
info "fault injected ($V). Start the unit to reproduce."
