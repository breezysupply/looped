#!/usr/bin/env bash
# L23 fault injection (checkpoint c2): start the two fixture sessions and the
# API's pooled write path. The variant chosen at setup decides which lock the
# fixture holds:
#   variant-a  row locks on three busy sensors, transaction left open
#   variant-b  a table lock on status_events, transaction left open
# Waits until the pool reports saturation, then returns. Nothing names which
# session is in the way; that is the exercise.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l23_guard
[ -f "$WORK/.l23-state.json" ] || die "run setup.sh first"
V="$(l23_variant)"
mkdir -p "$WORK/pool"
rm -f "$WORK/pool/pool-status.json"
export L23_VARIANT="$V"
info "starting fixture sessions and the API write path ($V)"
l23_dc --profile fault up -d fixtures >/dev/null
for _ in $(seq 1 30); do
  docker exec looped-l23-fixtures cat /tmp/fixtures-status.json 2>/dev/null | grep -q '"report": {"pid"' && break
  sleep 1
done
l23_dc --profile fault up -d pool >/dev/null
python3 - "$WORK/pool/pool-status.json" <<'PY'
import json, sys, time
p = sys.argv[1]
for _ in range(60):
    try:
        s = json.load(open(p))
        if s["in_use"] >= s["pool_size"] and s["acquire_timeouts"] > 0:
            print("==> API pool saturated: %d/%d connections in use, %d acquire timeouts so far" % (s["in_use"], s["pool_size"], s["acquire_timeouts"]))
            sys.exit(0)
    except (OSError, ValueError, KeyError):
        pass
    time.sleep(1)
print("WARN: pool did not report saturation within 60s; check docker logs looped-l23-pool", file=sys.stderr)
PY
python3 - "$WORK/.l23-state.json" <<'PY'
import json, sys, time
p = sys.argv[1]
s = json.load(open(p)); s["injected_at"] = time.time(); json.dump(s, open(p, "w"), indent=2)
PY
cat >> "$WORK/TICKET.md" <<'T'

## Update (c2)

On-call: "status updates from the sensors are not landing; the API logs say `pool exhausted`
(docker logs looped-l23-pool). Someone suggested restarting the database." Find what the
writes are waiting for, fix it with the smallest action, and make sure the twelve queued
updates land exactly once. Do not restart the database or the API.
T
info "fault injected; read the update in work/TICKET.md"
