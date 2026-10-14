#!/usr/bin/env bash
# L06 teardown: stop the lab proxy and Beacon, remove /opt/beacon-l06 (CAs, keys,
# certificates). The system trust store was never modified, so nothing else to undo.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l06
PATS=("tlsproxy.py --config $LAB/proxy.json" "beacon api --listen 127.0.0.1 --port 8086")
for f in "$LAB/run/proxy.pid" "$LAB/run/beacon.pid"; do
  [ -f "$f" ] && kill "$(cat "$f")" >/dev/null 2>&1 || true
done
for p in "${PATS[@]}"; do pkill -f "$p" >/dev/null 2>&1 || true; done
# wait (max 5 s) for graceful shutdown so the ports are free for the next setup
for _ in $(seq 1 25); do
  busy=0; for p in "${PATS[@]}"; do pgrep -f "$p" >/dev/null 2>&1 && busy=1; done
  [ "$busy" = 0 ] && break; sleep 0.2
done
rm -rf "${LAB:?}"
info "removed $LAB"
