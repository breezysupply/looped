#!/usr/bin/env bash
# L23 setup: start PostgreSQL 16 (compose project looped-l23), load the
# deterministic synthetic dataset, record its checksum and the ticket query's
# baseline plan cost, and write work/TICKET.md for the variant. The lock and
# pool fixtures are NOT started here; inject.sh starts them (checkpoint c2).
# Idempotent: an existing dataset is kept (reset.sh reloads it).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L23_PROJECT"
l23_guard

V="$(l23_variant)"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
mkdir -p "$WORK/pool"
EV="$(evidence_dir "$HERE")"

info "starting looped-l23-db (postgres 16.4, 127.0.0.1:15423)"
l23_dc up -d db >/dev/null
l23_wait_db

if [ -f "$WORK/.l23-state.json" ] && l23_psql -At -c "SELECT to_regclass('public.readings') IS NOT NULL" | grep -q t; then
  info "dataset already loaded; keeping it (reset.sh reloads it)"
else
  info "loading the synthetic dataset (200000 readings; deterministic)"
  l23_psql < "$HERE/assets/seed.sql"
  printf '%s\n' "$V" > "$WORK/.variant"
  Q="$(l23_ticket_query "$V")"
  printf '%s\n' "$Q" > "$WORK/ticket-query.sql"
  sum="$(l23_psql -At -c "SELECT md5(string_agg(id || '|' || sensor_id || '|' || site || '|' || ts || '|' || status || '|' || value, ',' ORDER BY id)) FROM readings")"
  cost="$(l23_psql -At -c "EXPLAIN (FORMAT JSON) $Q" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["Plan"]["Total Cost"])')"
  python3 - "$WORK/.l23-state.json" "$V" "$sum" "$cost" <<'PY'
import json, sys, time
path, v, s, c = sys.argv[1:5]
json.dump({"variant": v, "readings_md5": s, "baseline_cost": float(c), "seeded_at": time.time(), "injected_at": None}, open(path, "w"), indent=2)
PY
  info "dataset checksum $sum; ticket query baseline cost $cost"
fi
V="$(l23_variant)"
cat > "$WORK/TICKET.md" <<T
# BEACON-DATA-2311

The sensor history page times out for some sensors. The slow query, captured from the API's
log, is in work/ticket-query.sql:

    $(l23_ticket_query "$V")

Make it fast without changing what it returns, and save the plan before and after.
(Checkpoint c2 starts when you run inject.sh: the API's write path will report trouble.)
T
[ -f "$EV/L23-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L23-notes.md"
{
  echo "# L23 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "postgres: $(l23_psql -At -c 'SHOW server_version')"
} > "$EV/L23-tools.txt"
say ""
say "L23 ready ($V). Read work/TICKET.md. psql: docker exec -it looped-l23-db psql -U beacon -d beacon"
