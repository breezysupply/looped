#!/usr/bin/env bash
# L28 setup: work/ from starter/, the primary database seeded with a synthetic
# day of sensor records, the backups the nightly/hourly jobs and a standby
# produced during that day (into a private pool), then inject.sh assembles the
# variant's backup directory and causes the incident. Touches only work/,
# evidence/ and Compose project looped-l28. Idempotent: an existing work/ is reused.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L28_PROJECT"
l28_guard
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 not found; see profiles/compose/README.md"

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over, teardown.sh removes everything)"
  exit 0
fi
left="$(l28_list container; l28_list volume)"
[ -z "$left" ] || die "looped-l28 objects exist without a workspace (an old attempt?): $(echo "$left" | tr '\n' ' '); run teardown.sh first"

mkdir -p "$WORK/backups" "$WORK/incident" "$WORK/.l28/pool"
cp "$HERE/starter/compose.yaml" "$HERE/starter/api.env" "$WORK/"
cp "$HERE/assets/updates-template.md" "$WORK/incident/updates.md"
cp "$HERE/assets/followups-template.md" "$WORK/incident/followups.md"
EV="$(evidence_dir "$HERE")"
{
  echo "# L28 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "compose: $(docker compose version --short 2>/dev/null)"
} > "$EV/L28-tools.txt"

info "starting the primary database"
l28_dc up -d db >/dev/null
l28_wait_db looped-l28-db
POOL="$WORK/.l28/pool"
dump() { docker exec looped-l28-db pg_dump -U beacon -d beacon -Fc > "$POOL/$1"; }
info "seeding a synthetic day ($L28_DAY) and taking the day's backups"
l28_seed 00:00 02:00; dump nightly-0200.dump
l28_seed 02:00 10:40; dump standby-1040.dump      # what a lagging standby held at 13:30
l28_seed 10:40 12:00; dump hourly-1200.dump
l28_seed 12:00 13:00; dump hourly-1300.dump
l28_seed 13:00 13:40                               # written after the last backup
# the validator's oracle: count + checksum of the records each backup holds
python3 - "$WORK/.l28/expected.json" <<'PY'
import json, subprocess, sys
out = sys.argv[1]
cuts = {"nightly-0200.dump": "02:00", "standby-1040.dump": "10:40", "hourly-1200.dump": "12:00", "hourly-1300.dump": "13:00", "primary-at-fault": "23:59"}
res = {}
for name, cut in cuts.items():
    sql = ("SELECT count(*) || '|' || md5(string_agg(sensor_id || '/' || status || '/' || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI'), ',' "
           "ORDER BY created_at, sensor_id)) || '|' || to_char(max(created_at) AT TIME ZONE 'UTC', 'HH24:MI') FROM records WHERE created_at < timestamptz '2025-03-11 %s:00+00'" % cut)
    o = subprocess.run(["docker", "exec", "looped-l28-db", "psql", "-X", "-At", "-U", "beacon", "-d", "beacon", "-c", sql], capture_output=True, text=True, check=True).stdout.strip()
    n, md5, newest = o.split("|")
    res[name] = {"count": int(n), "md5": md5, "newest": newest}
json.dump(res, open(out, "w"), indent=1)
PY
info "starting the status API"
l28_dc up -d api >/dev/null
LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L28 ready — the incident has started. Read work/TICKET.md and open work/incident/updates.md."
