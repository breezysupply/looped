#!/usr/bin/env bash
# L25 variant configuration (run by setup.sh; run again to switch variant —
# it rewrites the exporter service, the report tool's lock/config and the
# scan report, and saves your previous copies as *.bak).
#   variant-a  a consumer configured the way it was before the last change
#              to how secrets are shipped; scan against an older lock
#   variant-b  a consumer configured the way the team did it in 2024; the
#              report tool renders operator templates
# Writes work/TICKET.md (what was reported, not why) and work/.variant.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
l25_guard
[ -f "$WORK/compose.yaml" ] || die "no work/; run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b) ;; *) die "unknown variant $V (variant-a | variant-b)" ;; esac
VD="$HERE/assets/variants/$V"

for f in compose.yaml patch/report/requirements.txt patch/report/report.json patch/triage.json; do
  [ -f "$WORK/$f" ] && cp "$WORK/$f" "$WORK/$f.bak"
done
cp "$HERE/starter/compose.yaml" "$WORK/compose.yaml"
python3 - "$WORK/compose.yaml" "$V" <<'PY'
import sys
path, variant = sys.argv[1:3]
src = open(path, encoding="utf-8").read()
start = src.index("  exporter:\n")
end = src.index("\nsecrets:\n")
if variant == "variant-a":
    block = """  exporter:
    <<: *consumer
    container_name: looped-l25-exporter
    environment:
      BEACON_CONSUMER: exporter
      BEACON_DB_USER: beacon_app
      BEACON_DB_PASSWORD_FILE: /run/secrets/exporter_db
      PYTHONDONTWRITEBYTECODE: "1"
    secrets:
      - exporter_db
    labels:
      looped.lab/id: L25
"""
    src = src[:start] + block + src[end:]
    src = src.replace("  db:\n    file: ./secrets/db.txt\n", "  db:\n    file: ./secrets/db.txt\n  exporter_db:\n    file: ./secrets/exporter-db.txt\n")
else:
    block = """  exporter:
    <<: *consumer
    container_name: looped-l25-exporter
    environment:
      BEACON_CONSUMER: exporter
      BEACON_DB_USER: beacon_app
      BEACON_DB_PASSWORD: ${EXPORTER_DB_PASSWORD:?set in work/.env}
      PYTHONDONTWRITEBYTECODE: "1"
    labels:
      looped.lab/id: L25
"""
    src = src[:start] + block + src[end:]
open(path, "w", encoding="utf-8").write(src)
PY
rm -f "$WORK/.env" "$WORK/secrets/exporter-db.txt"
if [ "$V" = variant-a ]; then
  cp "$WORK/secrets/db.txt" "$WORK/secrets/exporter-db.txt"
  chmod 600 "$WORK/secrets/exporter-db.txt"
else
  ( umask 077; printf 'EXPORTER_DB_PASSWORD=%s\n' "$(cat "$WORK/secrets/db.txt")" > "$WORK/.env" )
fi

cp "$VD/requirements.txt" "$WORK/patch/report/requirements.txt"
cp "$VD/report.json" "$WORK/patch/report/report.json"
cp "$VD/vuln-report.json" "$WORK/patch/vuln-report.json"
[ -f "$WORK/patch/triage.json" ] || cp "$HERE/assets/triage-template.json" "$WORK/patch/triage.json"

cat > "$WORK/TICKET.md" <<'T'
# BEACON-SEC-311 (sev 3) — database credential exposed

On 2026-10-12 the password of the `beacon_app` database role appeared in a CI job log that is
readable by every engineer. Rotate it today. Done means: the new credential is in use by every
consumer of the database (`ingest` and `exporter`), the exposed one is rejected by the server,
and no credential value appears in the ticket, your notes, your evidence or any container's
configuration or logs. Keep both consumers writing heartbeats; a short blip is acceptable,
a broken consumer at the end is not.

# BEACON-SEC-312 — release scan of beacon-report

The release scan for beacon-report 0.9.0 is attached as `work/patch/vuln-report.json`. Before
Friday's release: triage every finding (fix / not-applicable / already-fixed / unknown, with
the reason and the evidence you used) in `work/patch/triage.json`, patch what needs patching
in the pinned lock, rebuild and test the image as `looped-l25-report:patched`, and attach a
CycloneDX SBOM of what you shipped as `work/patch/sbom.cdx.json`.
T
printf '%s\n' "$V" > "$WORK/.variant"
if [ -z "${LOOPED_L25_NO_APPLY:-}" ] && docker inspect looped-l25-db >/dev/null 2>&1; then
  l25_dc up -d --remove-orphans >/dev/null
fi
info "variant $V configured; read $WORK/TICKET.md"
