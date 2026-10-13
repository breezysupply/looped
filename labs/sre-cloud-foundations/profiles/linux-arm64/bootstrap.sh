#!/usr/bin/env bash
# Baseline for the course VM. Run as root INSIDE the VM (vm-create.sh and
# vm-reset.sh do this). Idempotent: safe to re-run; it resets the Beacon
# install to the repository copy and removes lab units.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root (sudo)"; exit 1; }
[ "$(uname -s)" = Linux ] || { echo "this runs inside the Linux VM"; exit 1; }
if [ ! -f /etc/looped-vm ] && [ -z "${LOOPED_ALLOW_ANY_LINUX:-}" ]; then
  echo "ERROR: /etc/looped-vm missing. This bootstrap only runs in the course VM (or set LOOPED_ALLOW_ANY_LINUX=1 on a disposable Linux box you own)." >&2
  exit 1
fi
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SRC="$REPO/labs/sre-cloud-foundations/beacon"
[ -d "$SRC/beacon" ] || { echo "Beacon source not found at $SRC (is the repository mounted?)"; exit 1; }

echo "==> packages"
export DEBIAN_FRONTEND=noninteractive
apt-get install -y --no-install-recommends python3 iproute2 bind9-dnsutils bind9 nginx openssl curl jq stress-ng sqlite3 lsof >/dev/null
systemctl disable --now nginx bind9 named >/dev/null 2>&1 || true

echo "==> lab units removed"
for u in beacon beacon-worker beacon-proxy looped-dns-parent looped-dns-child looped-dns-resolver; do
  systemctl disable --now "$u" >/dev/null 2>&1 || true
  rm -f "/etc/systemd/system/$u.service"
done
systemctl daemon-reload

echo "==> beacon user and directories"
id beacon >/dev/null 2>&1 || useradd --system --home /opt/beacon --shell /usr/sbin/nologin beacon
rm -rf /opt/beacon /etc/beacon /var/lib/beacon
mkdir -p /opt/beacon /etc/beacon /var/lib/beacon
cp -r "$SRC/beacon" /opt/beacon/beacon
cp "$SRC/beacon.yaml" /etc/beacon/beacon.yaml
chown -R root:root /opt/beacon
chmod -R a+rX /opt/beacon
chown root:beacon /etc/beacon/beacon.yaml; chmod 640 /etc/beacon/beacon.yaml
chown -R beacon:beacon /var/lib/beacon; chmod 750 /var/lib/beacon

echo "==> lab filesystems and namespaces cleaned"
for ns in $(ip netns list 2>/dev/null | awk '{print $1}'); do case "$ns" in looped-*) ip netns delete "$ns" ;; esac; done
if mountpoint -q /mnt/looped-small 2>/dev/null; then umount /mnt/looped-small; fi
losetup -a 2>/dev/null | grep looped-small | cut -d: -f1 | xargs -r -n1 losetup -d
rm -rf /mnt/looped-small /var/tmp/looped-small.img /var/tmp/looped-inodes

echo "looped-foundations baseline $(date -u +%FT%TZ)" > /etc/looped-vm
echo "==> baseline ready ($(uname -m), $(python3 --version 2>&1))"
