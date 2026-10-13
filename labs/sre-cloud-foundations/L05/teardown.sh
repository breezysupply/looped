#!/usr/bin/env bash
# L05 teardown: stop the fixtures, delete only the looped-l05-* namespaces (their
# veth links go with them) and /etc/netns/looped-l05-client, remove /opt/beacon-l05.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l05
for f in "$LAB"/run/*.pid; do [ -f "$f" ] && kill "$(cat "$f")" >/dev/null 2>&1 || true; done
for ns in looped-l05-client looped-l05-rtr looped-l05-srv; do
  if ip netns list | grep -qw "$ns"; then
    ip netns pids "$ns" 2>/dev/null | xargs -r kill >/dev/null 2>&1 || true
    ip netns del "$ns"
  fi
done
for _ in $(seq 1 25); do  # wait (max 5 s) for the fixtures to exit
  pgrep -f "$LAB/labdns.py|beacon api --listen 10.55.2.80" >/dev/null 2>&1 || break; sleep 0.2
done
rm -rf "/etc/netns/looped-l05-client"
rm -rf "${LAB:?}"
info "removed looped-l05-* namespaces, /etc/netns/looped-l05-client and $LAB"
