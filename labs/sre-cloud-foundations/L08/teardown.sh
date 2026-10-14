#!/usr/bin/env bash
# L08 teardown: stop the fixture, remove the lab token, run files and generated
# output. Your invclient.py and tests stay.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_linux_vm
WORK="${L08_WORK:-$HERE/work}"
[ -d "$WORK" ] || { info "nothing to remove ($WORK missing)"; exit 0; }
if [ -f "$WORK/.run/server.pid" ]; then
  kill "$(cat "$WORK/.run/server.pid")" >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do kill -0 "$(cat "$WORK/.run/server.pid")" 2>/dev/null || break; sleep 0.2; done
fi
rm -rf "${WORK:?}/.run" "${WORK:?}/.secrets" "${WORK:?}/out" "${WORK:?}/__pycache__"
rm -f "$WORK/.variant"
info "fixture stopped; token, run files and output removed; your code kept in $WORK"
