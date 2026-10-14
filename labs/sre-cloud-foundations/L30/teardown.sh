#!/usr/bin/env bash
# L30 teardown: stop the fixture and remove the lab keys, run files, ticket and
# request copy. Your repro.py and customer-reply.md stay in the workspace;
# evidence/ is kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="${L30_WORK:-$HERE/work}"
[ -d "$WORK" ] || { info "nothing to remove ($WORK missing)"; exit 0; }
if [ -f "$WORK/.run/server.pid" ]; then
  kill "$(cat "$WORK/.run/server.pid")" >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do kill -0 "$(cat "$WORK/.run/server.pid")" 2>/dev/null || break; sleep 0.2; done
fi
rm -rf "${WORK:?}/.run" "${WORK:?}/.secrets" "${WORK:?}/__pycache__"
rm -f "$WORK/.variant" "$WORK/TICKET.md" "$WORK/customer-request.json"
info "fixture stopped; keys, run files and ticket removed; your repro.py and reply kept in $WORK"
