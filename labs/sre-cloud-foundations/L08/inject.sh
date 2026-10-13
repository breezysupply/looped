#!/usr/bin/env bash
# L08: (re)start the inventory fixture for a variant, in `faults` mode. The
# variant decides which page gets 429/503/a stall/a truncated body and where the
# loop mode repeats a token; inventory_server.py documents the behaviours.
#   LOOPED_VARIANT=variant-a   (default)
#   LOOPED_VARIANT=variant-b
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L08_WORK:-$HERE/work}"
[ -s "$WORK/.secrets/l08-token" ] || die "workspace or token missing; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
mkdir -p "$WORK/.run"
if [ -f "$WORK/.run/server.pid" ]; then
  kill "$(cat "$WORK/.run/server.pid")" >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do kill -0 "$(cat "$WORK/.run/server.pid")" 2>/dev/null || break; sleep 0.2; done
fi
if python3 -c "import socket; socket.create_connection(('127.0.0.1', 8098), 0.3).close()" 2>/dev/null; then
  die "something else is listening on 127.0.0.1:8098; stop it first (ss -ltnp | grep 8098)"
fi
nohup python3 "$HERE/assets/inventory_server.py" --port 8098 --variant "$V" --mode faults \
  --token-file "$WORK/.secrets/l08-token" >>"$WORK/.run/server.log" 2>&1 < /dev/null &
echo $! > "$WORK/.run/server.pid"
printf '%s\n' "$V" > "$WORK/.variant"
for _ in $(seq 1 40); do
  python3 -c "import socket; socket.create_connection(('127.0.0.1', 8098), 0.3).close()" 2>/dev/null && { info "fixture up on 127.0.0.1:8098 ($V, faults mode)"; exit 0; }
  sleep 0.25
done
die "fixture did not start; see $WORK/.run/server.log"
