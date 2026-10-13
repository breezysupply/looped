#!/usr/bin/env bash
# L25 setup: work/ from starter/, synthetic secrets (0600) in work/secrets/,
# the variant's configuration (inject.sh), then PostgreSQL + two consumers in
# Compose project looped-l25, and a baseline build of the beacon-report image.
# Touches only work/, evidence/, project looped-l25 and looped-l25-report:*.
# Idempotent: an existing work/ is reused (reset.sh starts over).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l25_guard
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 not found; see profiles/compose/README.md"

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over, teardown.sh removes everything)"
  l25_dc up -d >/dev/null
  exit 0
fi
left="$(l25_list container; l25_list volume)"
[ -z "$left" ] || die "looped-l25 objects exist without a workspace (an old attempt?): $(echo "$left" | tr '\n' ' '); run teardown.sh first"

info "preparing $WORK"
mkdir -p "$WORK/patch"
cp "$HERE/starter/compose.yaml" "$WORK/compose.yaml"
cp -R "$HERE/starter/report" "$WORK/patch/report"
mkdir -p "$WORK/secrets" "$WORK/.l25"
chmod 700 "$WORK/secrets" "$WORK/.l25"
l25_newsecret "$WORK/secrets/pg-admin.txt" >/dev/null
# the postgres entrypoint reads this file as uid 999 after dropping root, so it
# must be readable inside the container; it is only used on the local socket
chmod 644 "$WORK/secrets/pg-admin.txt"
l25_newsecret "$WORK/secrets/db.txt"
# the lab's private record of the value that leaked (ticket BEACON-SEC-311);
# only validate.py reads it, to prove the old credential no longer works
cp "$WORK/secrets/db.txt" "$WORK/.l25/leaked.txt"
chmod 600 "$WORK/.l25/leaked.txt"

EV="$(evidence_dir "$HERE")"
{
  echo "# L25 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "compose: $(docker compose version --short 2>/dev/null)"
  echo "engine: $(docker info --format '{{.OSType}}/{{.Architecture}} server {{.ServerVersion}}' 2>/dev/null)"
  echo "openssl: $(openssl version 2>/dev/null)"
} > "$EV/L25-tools.txt"
[ -f "$EV/L25-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L25-notes.md"

LOOPED_L25_NO_APPLY=1 bash "$HERE/inject.sh"

info "starting PostgreSQL (looped-l25-db)"
l25_dc up -d db >/dev/null
l25_wait_db
l25_set_password beacon_app "$WORK/secrets/db.txt"
info "starting the consumers (ingest, exporter)"
l25_dc up -d >/dev/null
for i in $(seq 1 30); do
  n="$(l25_psql -At -c "SELECT count(DISTINCT consumer) FROM heartbeats WHERE at > now() - interval '10 seconds'" 2>/dev/null || echo 0)"
  [ "$n" = 2 ] && break
  sleep 1
done
[ "${n:-0}" = 2 ] || die "consumers are not both writing heartbeats; docker logs looped-l25-ingest / looped-l25-exporter"
info "both consumers authenticate with the current credential"

info "baseline build of beacon-report (the release candidate the scan was about)"
bash "$HERE/assets/build-report.sh" baseline
say ""
say "L25 ready. Read work/TICKET.md, then start with:"
say "  docker compose -p looped-l25 -f $WORK/compose.yaml ps"
say "  docker logs --tail 3 looped-l25-exporter"
