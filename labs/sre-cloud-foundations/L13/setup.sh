#!/usr/bin/env bash
# L13 setup: build context in work/ (starter + a copy of the Beacon package),
# tool/engine inventory as first evidence, then inject.sh builds and runs the
# lab image for the chosen variant. Touches only work/, evidence/, the image
# looped-l13-beacon:1.4.0 and the container looped-l13-api. Idempotent.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../lib/looped.sh"
require_compose_project looped-l13   # Docker reachable; every name below is looped-l13-*

WORK="$HERE/work"
info "Preparing the build context at $WORK"
rm -rf "${WORK:?}"
mkdir -p "$WORK"
cp -R "$HERE/starter/." "$WORK/"
cp -R "$SRE_BEACON/beacon" "$WORK/beacon"

# Wheelhouse: the exact, hash-checked wheels for both architectures, fetched
# on the host so the image build itself needs no package index.
command -v python3 >/dev/null 2>&1 || die "python3 not found (needed to fetch the wheelhouse)"
info "Fetching the pinned wheels (linux/arm64 and linux/amd64, CPython 3.12) into $WORK/wheels"
mkdir -p "$WORK/wheels"
for plat in manylinux2014_aarch64 manylinux2014_x86_64; do
  python3 -m pip download --quiet --disable-pip-version-check --no-deps --only-binary=:all: \
    --python-version 3.12 --implementation cp --platform "$plat" \
    -d "$WORK/wheels" -r "$WORK/requirements.lock" \
    || die "pip download failed for $plat (network or proxy?); see docs/sre-cloud-foundations/troubleshooting.md"
done

EV="$(evidence_dir "$HERE")"
{
  echo "# L13 inventory — $(date -u +%FT%TZ)"
  record_versions
  echo "engine: $(docker info --format '{{.OSType}}/{{.Architecture}} server {{.ServerVersion}}' 2>/dev/null)"
  echo "buildx: $(docker buildx version 2>/dev/null || echo 'not installed')"
} > "$EV/L13-inventory.txt"
cat "$EV/L13-inventory.txt"
[ -f "$EV/L13-notes.md" ] || cp "$HERE/assets/notes-template.md" "$EV/L13-notes.md"

LOOPED_VARIANT="${LOOPED_VARIANT:-variant-a}" bash "$HERE/inject.sh"
say ""
say "L13 ready. Container: looped-l13-api, published on 127.0.0.1:18013."
say "Try:  curl -sS http://127.0.0.1:18013/healthz ; docker ps -a --filter label=looped.lab/id=L13"
say "Notes: $EV/L13-notes.md"
