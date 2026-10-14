#!/usr/bin/env bash
# L24 fault injection:
#   c1  this morning's backup work/backups/beacon-nightly-2026-10-13.dump is damaged
#       variant-a: the file was cut short      variant-b: bytes inside it were altered
#   c2  twenty delivery jobs are enqueued and the worker crashes once (fixture-controlled)
#       variant-a: crash after one side effect, before its ack
#       variant-b: the same plus three messages the producer enqueued twice
# Nothing printed here says which file is bad or why deliveries repeat.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L24_PROJECT"
l24_guard
[ -f "$WORK/.l24-state.json" ] || die "run setup.sh first"
V="$(l24_variant)"
B="$WORK/backups/beacon-nightly-2026-10-13.dump"
docker exec looped-l24-db pg_dump -Fc -U beacon -d beacon > "$B"
python3 - "$B" "$V" "$WORK/.l24-state.json" <<'PY'
import hashlib, json, sys, time
path, v, state = sys.argv[1:4]
data = bytearray(open(path, "rb").read())
if v == "variant-a":
    data = data[: int(len(data) * 0.7)]
else:
    mid = int(len(data) * 0.55)
    for i in range(mid, mid + 48):
        data[i] ^= 0x5A
open(path, "wb").write(bytes(data))
s = json.load(open(state))
s.update(injected_at=time.time(), damaged_sha256=hashlib.sha256(bytes(data)).hexdigest())
json.dump(s, open(state, "w"), indent=2)
PY
if [ "$V" = variant-b ]; then DUPS="'l24-msg-007','l24-msg-012','l24-msg-018'"; FAULT=l24-msg-015; else DUPS="''"; FAULT=l24-msg-004; fi
l24_psql <<SQL
INSERT INTO queue.faults (idempotency_key, mode) VALUES ('$FAULT', 'after-effect') ON CONFLICT DO NOTHING;
INSERT INTO queue.jobs (idempotency_key, sensor_id)
SELECT 'l24-msg-' || lpad(i::text, 3, '0'), 's-' || lpad(((i * 37) % 400)::text, 4, '0') FROM generate_series(1, 20) AS i;
INSERT INTO queue.jobs (idempotency_key, sensor_id)
SELECT idempotency_key, sensor_id FROM queue.jobs WHERE idempotency_key IN ($DUPS);
SQL
info "20 delivery messages enqueued; waiting for the worker to drain the queue"
for _ in $(seq 1 45); do
  left="$(l24_psql -At -c "SELECT count(*) FROM queue.jobs WHERE state <> 'done'")"
  [ "$left" = 0 ] && break
  sleep 1
done
cat > "$WORK/TICKET.md" <<'T'
# BEACON-DATA-2412 — recovery drill and a delivery complaint

1. **Recovery drill (c1).** Before Thursday's schema migration, prove we can restore Beacon's
   data from this morning's backup (`work/backups/`) into a FRESH database and that what comes
   back is what we have now. Measure how long recovery actually takes, start to verified.
2. **Delivery complaint (c2).** A downstream team says some sensors were notified twice
   today. The worker restarted once overnight (`docker ps` shows its restart count). Make a
   repeat delivery of the same message impossible, without losing any message.
T
info "faults injected ($V); read work/TICKET.md"
