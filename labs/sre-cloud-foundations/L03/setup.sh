#!/usr/bin/env bash
# L03 setup: Beacon installed the proper way on the VM (code, config, state,
# user, unit), then the fault from inject.sh. Run as root inside the VM.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
command -v systemctl >/dev/null 2>&1 || die "systemd is required (this is why the lab runs in the VM)"

info "beacon user, directories, code, config"
id beacon >/dev/null 2>&1 || useradd --system --home /opt/beacon --shell /usr/sbin/nologin beacon
systemctl disable --now beacon >/dev/null 2>&1 || true
rm -rf /opt/beacon /etc/beacon
mkdir -p /opt/beacon /etc/beacon /var/lib/beacon
cp -r "$SRE_BEACON/beacon" /opt/beacon/beacon
cp "$SRE_BEACON/beacon.yaml" /etc/beacon/beacon.yaml
chown -R root:root /opt/beacon && chmod -R a+rX /opt/beacon
chown root:beacon /etc/beacon/beacon.yaml && chmod 640 /etc/beacon/beacon.yaml
chown -R beacon:beacon /var/lib/beacon && chmod 750 /var/lib/beacon
rm -f /var/lib/beacon/beacon.db

info "unit"
cp "$SRE_BEACON/beacon.service" /etc/systemd/system/beacon.service
systemctl daemon-reload

mkdir -p "$HERE/evidence"
bash "$HERE/inject.sh"
say ""
say "L03 ready. Reproduce with:  sudo systemctl start beacon; systemctl status beacon --no-pager; journalctl -u beacon -n 20 --no-pager"
