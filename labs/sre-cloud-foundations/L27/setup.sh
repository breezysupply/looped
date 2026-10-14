#!/usr/bin/env bash
# L27 setup: work/ from starter/, the variant's limits (inject.sh), then
# PostgreSQL + one api replica in Compose project looped-l27, and a 20-second
# baseline load run at 60 requests/s (work/runs/baseline.json) that later
# results are compared with. Touches only work/, evidence/ and project looped-l27.
# Idempotent: an existing work/ is reused (reset.sh starts over).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
. "$HERE/assets/common.sh"
require_compose_project "$L27_PROJECT"
l27_guard
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 not found; see profiles/compose/README.md"

if [ -d "$WORK" ]; then
  info "work/ exists; reusing it (reset.sh starts over, teardown.sh removes everything)"
  l27_dc up -d >/dev/null
  exit 0
fi
left="$(l27_list container; l27_list volume)"
[ -z "$left" ] || die "looped-l27 objects exist without a workspace (an old attempt?): $(echo "$left" | tr '\n' ' '); run teardown.sh first"

mkdir -p "$WORK/runs" "$WORK/.l27"
cp "$HERE/starter/compose.yaml" "$WORK/compose.yaml"
sed -i.tmp "s/\${LOOPED_UID:-65534}:\${LOOPED_GID:-65534}/$LOOPED_UID:$LOOPED_GID/" "$WORK/compose.yaml" && rm -f "$WORK/compose.yaml.tmp"
# fingerprints of the fixture code, so the validator can tell tuning from editing the fixture
python3 - "$HERE" "$WORK/.l27/fixtures.json" <<'PY'
import hashlib, json, sys
here, out = sys.argv[1:3]
files = ["assets/ingest.py", "assets/loadgen.py", "assets/pgmini.py", "assets/init/01-schema.sql"]
json.dump({f: hashlib.sha256(open(here + "/" + f, "rb").read()).hexdigest() for f in files}, open(out, "w"), indent=1)
PY

EV="$(evidence_dir "$HERE")"
{
  echo "# L27 tool inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "compose: $(docker compose version --short 2>/dev/null)"
  echo "engine: $(docker info --format '{{.OSType}}/{{.Architecture}} server {{.ServerVersion}}, {{.NCPU}} CPUs' 2>/dev/null)"
} > "$EV/L27-tools.txt"
[ -f "$EV/L27-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L27-notes.md"

LOOPED_L27_NO_APPLY=1 bash "$HERE/inject.sh"
info "starting PostgreSQL and one api replica"
l27_dc up -d >/dev/null
l27_wait
info "baseline: 60 requests/s for 20 s with the current limits and client policy (bounded)"
bash "$HERE/assets/run-load.sh" baseline 60 20
cp "$WORK/runs/baseline.json" "$WORK/.l27/baseline.json"
say ""
say "L27 ready. The ticket is work/TICKET.md. Useful:"
say "  bash $HERE/assets/run-load.sh <label> [rps] [seconds]"
say "  docker compose -p looped-l27 -f $WORK/compose.yaml exec api python3 -c \"import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/stats').read().decode())\""
