#!/usr/bin/env bash
# L30 fault: (re)start the summaries fixture in the mode behind this variant's
# customer ticket and write work/TICKET.md. The ticket describes the symptom
# only; the mode is recorded in work/.variant for the validator.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c | variant-d | variant-e   (default variant-a)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_workstation python3
WORK="${L30_WORK:-$HERE/work}"
[ -s "$WORK/.secrets/customer-key" ] || die "workspace or keys missing; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in
  variant-a) MODE=auth-rotated ;;
  variant-b) MODE=rate-limited ;;
  variant-c) MODE=stream-cut ;;
  variant-d) MODE=timeout ;;
  variant-e) MODE=not-entitled ;;
  *) die "unknown variant $V (variant-a .. variant-e)" ;;
esac
mkdir -p "$WORK/.run"
if [ -f "$WORK/.run/server.pid" ]; then
  kill "$(cat "$WORK/.run/server.pid")" >/dev/null 2>&1 || true
  for _ in $(seq 1 25); do kill -0 "$(cat "$WORK/.run/server.pid")" 2>/dev/null || break; sleep 0.2; done
  rm -f "$WORK/.run/server.pid"
fi
if python3 -c "import socket; socket.create_connection(('127.0.0.1', 8130), 0.3).close()" 2>/dev/null; then
  die "something else is listening on 127.0.0.1:8130; stop it first (lsof -nP -iTCP:8130 -sTCP:LISTEN)"
fi
nohup python3 "$HERE/assets/support_api.py" --port 8130 --mode "$MODE" \
  --keys-dir "$WORK/.secrets" --run-dir "$WORK/.run" >>"$WORK/.run/server.log" 2>&1 < /dev/null &
echo $! > "$WORK/.run/server.pid"
printf '%s\n' "$V" > "$WORK/.variant"
{ cat "$HERE/assets/tickets/$V.md"; echo; cat "$HERE/assets/tickets/common.md"; } > "$WORK/TICKET.md"
for _ in $(seq 1 40); do
  python3 -c "import socket; socket.create_connection(('127.0.0.1', 8130), 0.3).close()" 2>/dev/null && { info "fixture up on 127.0.0.1:8130 ($V); ticket in $WORK/TICKET.md"; exit 0; }
  sleep 0.25
done
die "fixture did not start; see $WORK/.run/server.log"
