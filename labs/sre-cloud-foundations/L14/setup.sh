#!/usr/bin/env bash
# L14 setup: work/ = starter compose project + Beacon package + wheelhouse,
# inventory as first evidence, inject the chosen variant, then build and
# start the project looped-l14. Touches only work/, evidence/ and Compose
# project looped-l14 (containers, network, volumes, the image
# looped-l14-beacon:1.4.0). Existing looped-l14 volumes are reused: setup
# never deletes data (see reset.sh for LOOPED_RESET_DATA=1).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
PROJECT=looped-l14
require_compose_project "$PROJECT"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 (docker compose) not found; see profiles/compose/README.md"

WORK="$HERE/work"
info "Preparing $WORK"
rm -rf "${WORK:?}"
mkdir -p "$WORK"
cp -R "$HERE/starter/." "$WORK/"
cp -R "$SRE_BEACON/beacon" "$WORK/app/beacon"
command -v python3 >/dev/null 2>&1 || die "python3 not found (needed to fetch the wheelhouse)"
info "Fetching the pinned wheels (linux/arm64 and linux/amd64, CPython 3.12) into $WORK/app/wheels"
mkdir -p "$WORK/app/wheels"
for plat in manylinux2014_aarch64 manylinux2014_x86_64; do
  python3 -m pip download --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
    --python-version 3.12 --implementation cp --platform "$plat" \
    -d "$WORK/app/wheels" -r "$WORK/app/requirements.lock" \
    || die "pip download failed for $plat (network or proxy?); see docs/sre-cloud-foundations/troubleshooting.md"
done

EV="$(evidence_dir "$HERE")"
{
  echo "# L14 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "compose: $(docker compose version --short 2>/dev/null)"
  echo "engine: $(docker info --format '{{.OSType}}/{{.Architecture}} server {{.ServerVersion}}' 2>/dev/null)"
} > "$EV/L14-inventory.txt"
cat "$EV/L14-inventory.txt"
[ -f "$EV/L14-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L14-notes.md"

LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L14 started (not necessarily healthy — that is the exercise)."
say "  docker compose -f $WORK/compose.yaml ps"
say "  docker compose -f $WORK/compose.yaml logs --tail 20 api"
say "  curl -sS http://127.0.0.1:18014/ready"
