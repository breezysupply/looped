#!/usr/bin/env bash
# L04 teardown: stop only the lab's own processes (by recorded PID or by the
# lab's exact paths), unmount the lab image, remove /opt/beacon-l04. Evidence stays.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l04
MNT="$LAB/mnt"
for f in "$LAB/run/beacon.pid" "$LAB/run/reporter.pid"; do
  [ -f "$f" ] && kill "$(cat "$f")" >/dev/null 2>&1 || true
done
pkill -f "$LAB/bin/report-builder.py" >/dev/null 2>&1 || true
pkill -f "$LAB/bin/reporter.py" >/dev/null 2>&1 || true
pkill -f "beacon api --config $LAB/beacon.yaml" >/dev/null 2>&1 || true
for _ in $(seq 1 25); do  # wait (max 5 s) for the lab processes to exit
  pgrep -f "$LAB/bin/|beacon api --config $LAB/beacon.yaml" >/dev/null 2>&1 || break; sleep 0.2
done
if mountpoint -q "$MNT" 2>/dev/null; then
  umount "$MNT" || { sleep 1; umount "$MNT"; }
fi
# a loop device left attached to our image (mount normally auto-clears it)
losetup -j "$LAB/labfs.img" 2>/dev/null | cut -d: -f1 | while read -r dev; do [ -n "$dev" ] && losetup -d "$dev" || true; done
rm -rf "${LAB:?}"
info "unmounted the lab image and removed $LAB"
