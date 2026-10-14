#!/usr/bin/env bash
# L06: (re)start the lab TLS proxy with /opt/beacon-l06/proxy.json. Use after
# editing the config or replacing a certificate.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
[ "$(id -u)" = 0 ] || die "run with sudo"
LAB=/opt/beacon-l06
[ -f "$LAB/proxy.json" ] || die "run setup.sh first"
if [ -f "$LAB/run/proxy.pid" ]; then kill "$(cat "$LAB/run/proxy.pid")" >/dev/null 2>&1 || true; fi
pkill -f "tlsproxy.py --config $LAB/proxy.json" >/dev/null 2>&1 || true
for _ in $(seq 1 25); do pgrep -f "tlsproxy.py --config $LAB/proxy.json" >/dev/null 2>&1 || break; sleep 0.2; done
setsid python3 "$LAB/tlsproxy.py" --config "$LAB/proxy.json" >>"$LAB/run/proxy.log" 2>&1 < /dev/null &
echo $! > "$LAB/run/proxy.pid"
for _ in $(seq 1 40); do
  python3 -c "import socket; socket.create_connection(('127.0.0.1', 8446), 0.3).close()" 2>/dev/null && { info "proxy listening on 127.0.0.1:8446 (log: $LAB/run/proxy.log)"; exit 0; }
  kill -0 "$(cat "$LAB/run/proxy.pid")" 2>/dev/null || die "proxy exited; see $LAB/run/proxy.log"
  python3 -c "import time; time.sleep(0.25)"
done
die "proxy did not start listening; see $LAB/run/proxy.log"
