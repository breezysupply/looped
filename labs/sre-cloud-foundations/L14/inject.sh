#!/usr/bin/env bash
# L14 fault injection: restore work/compose.yaml from starter/, apply the
# variant, then (re)build and start the project.
#   LOOPED_VARIANT=variant-a | variant-b | variant-c   (default variant-a)
# Fixture-controlled where noted; the validator reads work/.variant only to
# label the evidence.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
PROJECT=looped-l14
require_compose_project "$PROJECT"
WORK="$HERE/work"
[ -d "$WORK/app/beacon" ] || die "run setup.sh first"
V="${LOOPED_VARIANT:-${1:-variant-a}}"
case "$V" in variant-a|variant-b|variant-c) ;; *) die "unknown variant $V (variant-a | variant-b | variant-c)" ;; esac
cp "$HERE/starter/compose.yaml" "$WORK/compose.yaml"
printf '%s\n' "$V" > "$WORK/.variant"

python3 - "$WORK/compose.yaml" "$V" <<'PY'
import sys
path, v = sys.argv[1], sys.argv[2]
s = open(path, encoding="utf-8").read()
def sub(old, new):
    global s
    assert old in s, old
    s = s.replace(old, new, 1)
if v == "variant-a":
    sub("@db:5432/beacon", "@postgres:5432/beacon")
elif v == "variant-b":
    # fixture-controlled: the database host is slow to come up
    sub("    labels:\n      looped.lab/id: L14\n    environment:\n      POSTGRES_USER",
        "    labels:\n      looped.lab/id: L14\n"
        "    entrypoint: [\"sh\", \"-c\", \"echo 'lab fixture: slow storage, start delayed 45s'; sleep 45; exec docker-entrypoint.sh postgres\"]\n"
        "    environment:\n      POSTGRES_USER")
    start = s.index("    healthcheck:\n      # TCP on 127.0.0.1")
    end = s.index("    stop_grace_period: 20s")
    s = s[:start] + s[end:]
    sub("      db:\n        condition: service_healthy", "      db:\n        condition: service_started")
elif v == "variant-c":
    sub("      - pgdata:/var/lib/postgresql/data", "      - pgdata:/var/lib/postgres/data")
open(path, "w", encoding="utf-8").write(s)
PY

info "building and starting project $PROJECT ($V)"
dc "$PROJECT" -f "$WORK/compose.yaml" build --quiet
dc "$PROJECT" -f "$WORK/compose.yaml" up -d --quiet-pull
info "fault injected ($V). Watch: docker compose -f $WORK/compose.yaml ps"
