#!/usr/bin/env bash
# L24 setup: start Beacon's PostgreSQL (compose project looped-l24), load the
# deterministic dataset, take LAST NIGHT's backup (custom format), then apply
# today's writes, and start the queue worker from work/worker.py. Records the
# source checksum. inject.sh adds this morning's backup and the queue faults.
# Idempotent: an existing dataset and work/worker.py are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L24_PROJECT"
l24_guard
V="$(l24_variant)"
[ -n "${LOOPED_VARIANT:-}" ] && V="$LOOPED_VARIANT"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
mkdir -p "$WORK/backups"
EV="$(evidence_dir "$HERE")"
[ -f "$WORK/worker.py" ] || cp "$HERE/starter/worker.py" "$WORK/worker.py"

info "starting looped-l24-db (postgres 16.4, 127.0.0.1:15424)"
l24_dc up -d db >/dev/null
l24_wait looped-l24-db
if [ -f "$WORK/.l24-state.json" ] && l24_psql -At -c "SELECT to_regclass('public.records') IS NOT NULL" | grep -q t; then
  info "dataset already loaded; keeping it (reset.sh reloads it)"
else
  info "loading the synthetic dataset and taking last night's backup"
  l24_psql < "$HERE/assets/schema.sql"
  docker exec looped-l24-db pg_dump -Fc -U beacon -d beacon > "$WORK/backups/beacon-nightly-2026-10-12.dump"
  l24_psql < "$HERE/assets/today.sql"
  printf '%s\n' "$V" > "$WORK/.variant"
  read -r n sum <<<"$(l24_records_md5)"
  python3 - "$WORK/.l24-state.json" "$V" "$n" "$sum" <<'PY'
import json, sys, time
p, v, n, s = sys.argv[1:5]
json.dump({"variant": v, "records": int(n), "records_md5": s, "seeded_at": time.time(), "injected_at": None}, open(p, "w"), indent=2)
PY
  info "source: $n records, md5 $sum"
fi
info "starting the queue worker (work/worker.py)"
l24_dc up -d worker >/dev/null
[ -f "$EV/L24-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L24-notes.md"
{
  echo "# L24 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "postgres: $(l24_psql -At -c 'SHOW server_version')"
} > "$EV/L24-tools.txt"
say ""
say "L24 ready ($(l24_variant)). Run inject.sh, then read work/TICKET.md."
